import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir } from "../../lib/imprimir";
import { htmlConvenioConfidencialidad } from "../../lib/documentosRh";
import { patronDe } from "../MisDocumentos";
import type { EmpresaPerfilLegal, Personal, SolicitudFirma } from "../../types/database";

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

const ESTATUS: Record<SolicitudFirma["estatus"], { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente de firma", clase: "bg-amber-100 text-amber-800" },
  firmado: { texto: "Firmado", clase: "bg-emerald-100 text-emerald-800" },
  cancelado: { texto: "Cancelado", clase: "bg-slate-100 text-slate-600" },
};

/** RH solicita el convenio de confidencialidad (NDA) a personas dadas de
 * alta; ellas lo firman desde "Mis documentos" y aquí se ve el estatus y se
 * imprime la versión firmada. */
export function SolicitudesNda({ personal }: { personal: Personal[] }) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: solicitudes } = useQuery({
    queryKey: ["rh-solicitudes-firma"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("solicitudes_firma").select("*, empresa:empresa_id(nombre)").order("created_at", { ascending: false });
      if (err) throw err;
      return data as (SolicitudFirma & { empresa: { nombre: string } | null })[];
    },
  });
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (err) throw err;
      return data as { id: string; nombre: string }[];
    },
  });
  const { data: perfilesLegales } = useQuery({
    queryKey: ["perfiles-legales-todos"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("empresas_perfil_legal").select("*");
      if (err) throw err;
      return data as EmpresaPerfilLegal[];
    },
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["rh-solicitudes-firma"] });

  const solicitar = useMutation({
    mutationFn: async (p: { personal_id: string; empresa_id: string; puesto: string | null; mensaje: string | null }) => {
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("solicitudes_firma").insert({ ...p, tipo: "nda", solicitado_por: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setAviso("Solicitud enviada. La persona la verá en Inicio → Mis documentos, en \"Documentos por firmar\".");
      setAbierto(false);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from("solicitudes_firma").update({ estatus: "cancelado", cancelado_en: new Date().toISOString() }).eq("id", id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function onSolicitar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const fd = new FormData(e.currentTarget);
    const personalId = String(fd.get("personal_id") ?? "");
    const persona = personal.find((p) => p.id === personalId);
    solicitar.mutate({
      personal_id: personalId,
      empresa_id: String(fd.get("empresa_id") ?? ""),
      puesto: String(fd.get("puesto") ?? "").trim() || persona?.puesto || null,
      mensaje: String(fd.get("mensaje") ?? "").trim() || null,
    });
  }

  function imprimir(s: SolicitudFirma & { empresa: { nombre: string } | null }) {
    const persona = personal.find((p) => p.id === s.personal_id);
    if (!persona) return setError("La persona ya no está en Personal.");
    const html = htmlConvenioConfidencialidad(
      persona,
      patronDe(perfilesLegales, s.empresa_id, s.empresa?.nombre ?? null),
      s.puesto,
      s.fecha_convenio,
      s.estatus === "firmado" && s.firma_imagen && s.firmado_en ? { nombre: s.firma_nombre ?? persona.nombre, imagen: s.firma_imagen, firmado_en: s.firmado_en, dispositivo: s.firma_dispositivo } : null,
    );
    if (!abrirParaImprimir(html)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  const nombrePersona = new Map(personal.map((p) => [p.id, p.nombre]));
  const pendientes = (solicitudes ?? []).filter((s) => s.estatus === "pendiente").length;
  const conCuenta = personal.filter((p) => p.activo && p.profile_id);
  const sinCuenta = personal.filter((p) => p.activo && !p.profile_id).length;

  return (
    <div className="mb-6 rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Convenios de confidencialidad (NDA)</h3>
          <p className="text-xs text-slate-500">
            Solicita la firma a una persona con cuenta ligada; ella lo lee y firma desde su teléfono en "Mis documentos". {pendientes > 0 && `${pendientes} pendiente(s).`}
          </p>
        </div>
        <button onClick={() => setAbierto((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          {abierto ? "Cancelar" : "Solicitar NDA"}
        </button>
      </div>

      {abierto && (
        <form onSubmit={onSolicitar} className="mt-3 grid grid-cols-1 gap-2 rounded bg-slate-50 p-3 sm:grid-cols-4">
          <div>
            <label className={etiqueta}>Persona *</label>
            <select name="personal_id" required className={campo} defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {conCuenta.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            {sinCuenta > 0 && <p className="mt-1 text-[11px] text-amber-700">{sinCuenta} persona(s) activa(s) sin cuenta ligada no aparecen: liga su cuenta en Nómina y asistencia.</p>}
          </div>
          <div>
            <label className={etiqueta}>Empresa (LA EMPRESA) *</label>
            <select name="empresa_id" required className={campo} defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Puesto (para el texto)</label>
            <input name="puesto" placeholder="Se toma de Personal si se deja vacío" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Mensaje para la persona</label>
            <input name="mensaje" placeholder="Opcional" className={campo} />
          </div>
          <div className="sm:col-span-4">
            <button disabled={solicitar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {solicitar.isPending ? "Enviando…" : "Enviar solicitud de firma"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</p>}

      {solicitudes && solicitudes.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1">Persona</th>
              <th className="py-1">Empresa</th>
              <th className="py-1">Solicitado</th>
              <th className="py-1">Estatus</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {solicitudes.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1.5">{nombrePersona.get(s.personal_id) ?? "—"}</td>
                <td className="py-1.5 text-slate-500">{s.empresa?.nombre ?? "—"}</td>
                <td className="py-1.5 text-slate-500">{new Date(s.solicitado_en).toLocaleDateString("es-MX")}</td>
                <td className="py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTATUS[s.estatus].clase}`}>{ESTATUS[s.estatus].texto}</span>
                  {s.estatus === "firmado" && s.firmado_en && <div className="text-[10px] text-slate-400">{new Date(s.firmado_en).toLocaleString("es-MX")} · {s.firma_nombre}</div>}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right text-xs">
                  <button onClick={() => imprimir(s)} className="mr-2 text-slate-700 underline">
                    {s.estatus === "firmado" ? "Imprimir firmado" : "Ver borrador"}
                  </button>
                  {s.estatus === "pendiente" && (
                    <button onClick={() => cancelar.mutate(s.id)} className="text-slate-500 underline">
                      Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
