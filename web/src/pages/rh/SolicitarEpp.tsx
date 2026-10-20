import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { ETIQUETA_SOLICITUD_EPP, limpiarPiezasSolicitud, revisarSolicitudEpp, type EstadoSolicitudEpp, type PiezaSolicitud } from "../../lib/epp";

// Solicitud de EPP (21-oct-2026, Mario: "da de alta a los supervisores y
// revisa que Christian tenga habilitada la solicitud de EPP"). Supervisores,
// responsables de obra y RH piden equipo de protección para su gente; RH la
// atiende en Equipo de protección (EPP) y de ahí sale la entrega con su
// responsiva. La obra es opcional: si no se elige, RH la pone al atender.

interface Persona {
  id: string;
  nombre: string;
  puesto: string | null;
  empresa: string | null;
  a_mi_cargo: boolean;
}

interface Solicitud {
  id: string;
  folio: string;
  estado: EstadoSolicitudEpp;
  personal_id: string;
  notas: string | null;
  rechazo_motivo: string | null;
  created_at: string;
  atendida_en: string | null;
  epp_solicitud_lineas: { id: string; descripcion: string; talla: string | null; cantidad: number }[];
}

const filaVacia = (): PiezaSolicitud => ({ descripcion: "", talla: "", cantidad: "1" });
const campo = "rounded border border-slate-300 px-2 py-1.5 text-sm";
const SUGERIDAS = ["Casco", "Chaleco reflejante", "Botas de seguridad", "Guantes", "Lentes de seguridad", "Tapones auditivos", "Arnés"];

const COLOR_ESTADO: Record<EstadoSolicitudEpp, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  atendida: "bg-emerald-100 text-emerald-800",
  rechazada: "bg-red-100 text-red-800",
};

export function SolicitarEpp() {
  const qc = useQueryClient();
  const [personalId, setPersonalId] = useState("");
  const [proyectoId, setProyectoId] = useState("");
  const [notas, setNotas] = useState("");
  const [filas, setFilas] = useState<PiezaSolicitud[]>([filaVacia()]);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const personas = useQuery({
    queryKey: ["epp-personas-solicitar"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_epp_personas_para_solicitar");
      if (error) throw error;
      return (data ?? []) as Persona[];
    },
  });
  const obras = useQuery({
    queryKey: ["epp-solicitar-obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre, empresas(codigo)").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nombre: string; empresas: { codigo: string } | null }[];
    },
  });
  const mias = useQuery({
    queryKey: ["epp-mis-solicitudes"],
    queryFn: async () => {
      const { data: sesion } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("epp_solicitudes")
        .select("id, folio, estado, personal_id, notas, rechazo_motivo, created_at, atendida_en, epp_solicitud_lineas(id, descripcion, talla, cantidad)")
        .eq("solicitado_por", sesion.session?.user.id ?? "")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Solicitud[];
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      const piezas = limpiarPiezasSolicitud(filas);
      const problema = revisarSolicitudEpp(personalId, piezas);
      if (problema) throw new Error(problema);
      const { data, error } = await supabase.rpc("fn_epp_solicitar", {
        p_personal: personalId,
        p_proyecto: proyectoId || null,
        p_lineas: piezas,
        p_notas: notas.trim() || null,
      });
      if (error) throw error;
      return data as { folio: string };
    },
    onSuccess: (r) => {
      setAviso({ tipo: "ok", texto: `Solicitud ${r.folio} enviada a RH. Aquí abajo ves cuando la atiendan.` });
      setPersonalId("");
      setProyectoId("");
      setNotas("");
      setFilas([filaVacia()]);
      qc.invalidateQueries({ queryKey: ["epp-mis-solicitudes"] });
    },
    onError: (e: Error) => setAviso({ tipo: "error", texto: e.message }),
  });

  const nombreDe = new Map((personas.data ?? []).map((p) => [p.id, p.nombre]));
  const aMiCargo = (personas.data ?? []).filter((p) => p.a_mi_cargo);
  const resto = (personas.data ?? []).filter((p) => !p.a_mi_cargo);
  const cambiarFila = (i: number, cambios: Partial<PiezaSolicitud>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));

  if (personas.error) {
    return <p className="p-8 text-center text-sm text-slate-500">Solo supervisores, responsables de obra y RH piden equipo de protección.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Solicitar equipo de protección (EPP)</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Pide casco, chaleco, botas y lo que necesite tu gente. Le llega a RH, que lo entrega de bodega o lo pide a compras; la persona firma su responsiva al
          recibirlo.
        </p>
      </div>

      {aviso && <p className={`rounded px-3 py-2 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAviso(null);
          enviar.mutate();
        }}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            ¿Para quién?
            <select value={personalId} onChange={(e) => setPersonalId(e.target.value)} className={`mt-1 block w-full ${campo}`}>
              <option value="">Elige…</option>
              {aMiCargo.length > 0 && (
                <optgroup label="A tu cargo">
                  {aMiCargo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {p.puesto ? ` · ${p.puesto}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={aMiCargo.length ? "Resto del personal" : "Personal"}>
                {resto.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.puesto ? ` · ${p.puesto}` : ""}
                    {p.empresa ? ` (${p.empresa})` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Obra (opcional; si no la eliges, RH la pone)
            <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className={`mt-1 block w-full ${campo}`}>
              <option value="">Sin obra</option>
              {(obras.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                  {o.empresas?.codigo ? ` (${o.empresas.codigo})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Piezas</p>
          {filas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                list="epp-sugeridas"
                value={f.descripcion}
                onChange={(e) => cambiarFila(i, { descripcion: e.target.value })}
                placeholder="Ej. Botas de seguridad"
                className={`min-w-0 flex-1 ${campo}`}
              />
              <input value={f.talla} onChange={(e) => cambiarFila(i, { talla: e.target.value })} placeholder="Talla" className={`w-20 ${campo}`} />
              <input
                value={f.cantidad}
                onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                inputMode="decimal"
                placeholder="Cant."
                className={`w-16 ${campo}`}
              />
              {filas.length > 1 && (
                <button type="button" onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))} className="text-xs text-red-600 underline">
                  quitar
                </button>
              )}
            </div>
          ))}
          <datalist id="epp-sugeridas">
            {SUGERIDAS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button type="button" onClick={() => setFilas((fs) => [...fs, filaVacia()])} className="text-xs text-sky-700 underline">
            + agregar pieza
          </button>
        </div>

        <label className="block text-xs text-slate-600">
          Nota para RH (opcional)
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. entra el lunes a la obra" className={`mt-1 block w-full ${campo}`} />
        </label>

        <button disabled={enviar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {enviar.isPending ? "Enviando…" : "Enviar a RH"}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Mis solicitudes</h2>
        {mias.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {mias.data && mias.data.length === 0 && <p className="text-sm text-slate-500">Todavía no has pedido equipo.</p>}
        <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {(mias.data ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 text-sm">
              <span className="font-mono font-semibold">{s.folio}</span>
              <span className="min-w-0 flex-1">
                {nombreDe.get(s.personal_id) ?? "—"}
                <span className="block text-xs text-slate-500">
                  {s.epp_solicitud_lineas.map((l) => `${l.cantidad} ${l.descripcion}${l.talla ? ` (${l.talla})` : ""}`).join(" · ")}
                </span>
                {s.estado === "rechazada" && s.rechazo_motivo && <span className="block text-xs text-red-700">Motivo: {s.rechazo_motivo}</span>}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[s.estado]}`}>{ETIQUETA_SOLICITUD_EPP[s.estado]}</span>
              <span className="text-xs text-slate-500">{new Date(s.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
