import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import type { FilaPerfilLegal } from "../../lib/contratoCredito";

type Campos = { [K in keyof FilaPerfilLegal]: string };

const CAMPOS: { k: keyof FilaPerfilLegal; t: string; tipo?: string; ancho?: boolean; ayuda?: string }[] = [
  { k: "razon_social", t: "Razón social", ancho: true, ayuda: "ACEROS Y ENVASADOS DE PUEBLA, S.A. DE C.V." },
  { k: "rfc", t: "RFC" },
  { k: "representante_legal_nombre", t: "Representante legal", ayuda: "ERENDIRA SOLIS TECUATL" },
  { k: "representante_legal_puesto", t: "Puesto", ayuda: "ADMINISTRADOR ÚNICO" },
  { k: "representante_tratamiento", t: "Tratamiento", ayuda: "LA C. / EL C." },
  { k: "representante_titulo", t: "Título en la firma", ayuda: "LICENCIADA" },
  { k: "objeto_social", t: "Objeto social (antecedente I)", ancho: true },
  { k: "escritura_constitucion_numero", t: "Constitutiva: número" },
  { k: "escritura_constitucion_volumen", t: "Volumen" },
  { k: "escritura_constitucion_fecha", t: "Fecha", tipo: "date" },
  { k: "escritura_constitucion_notario", t: "Notario (con título)", ayuda: "Licenciado Arturo Díaz González" },
  { k: "escritura_constitucion_notaria_numero", t: "Notaría número" },
  { k: "escritura_constitucion_distrito_judicial", t: "Distrito judicial" },
  { k: "escritura_poderes_numero", t: "Poderes: número" },
  { k: "escritura_poderes_volumen", t: "Volumen" },
  { k: "escritura_poderes_fecha", t: "Fecha de protocolización", tipo: "date" },
  { k: "escritura_poderes_notario", t: "Notario (con título)", ayuda: "Licenciada María Emilia Sesma Téllez" },
  { k: "escritura_poderes_notaria_numero", t: "Notaría número" },
  { k: "escritura_poderes_distrito_judicial", t: "Distrito judicial", ayuda: "Cholula, Puebla" },
  { k: "domicilio_legal", t: "Domicilio", ancho: true },
  { k: "correo", t: "Correo para notificaciones" },
  { k: "telefono", t: "Teléfono" },
  { k: "ciudad_firma", t: "Lugar de firma", ancho: true, ayuda: "Heroica Puebla de Zaragoza, Estado de Puebla" },
];

const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function vacio(): Campos {
  return Object.fromEntries(CAMPOS.map((c) => [c.k, ""])) as Campos;
}

/** Datos de la empresa que vende ("EL PROVEEDOR") tal como salen en el
 * contrato: razón social, representante, escrituras y contacto. Es el mismo
 * perfil legal que usa RH en sus contratos. */
export function DatosEmpresaLegal() {
  const { suscripcionPermiteEscribir } = useAuth();
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [f, setF] = useState<Campos>(vacio());
  const [msg, setMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    enabled: !!empresa,
    queryKey: ["perfil-legal-empresa", empresa],
    queryFn: async () => {
      const { data: fila, error } = await supabase.from("empresas_perfil_legal").select("*").eq("empresa_id", empresa).maybeSingle();
      if (error) throw error;
      return fila as (FilaPerfilLegal & { empresa_id: string }) | null;
    },
  });

  useEffect(() => {
    const base = vacio();
    if (data) for (const c of CAMPOS) base[c.k] = String(data[c.k] ?? "");
    setF(base);
  }, [data]);

  const guardar = useMutation({
    mutationFn: async () => {
      const fila: Record<string, string | null> = { empresa_id: empresa };
      for (const c of CAMPOS) fila[c.k] = f[c.k].trim() || null;
      const { error } = await supabase.from("empresas_perfil_legal").upsert(fila, { onConflict: "empresa_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      setMsg("Guardado.");
      queryClient.invalidateQueries({ queryKey: ["perfil-legal-empresa"] });
      queryClient.invalidateQueries({ queryKey: ["perfil-legal-contrato"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorEmpresa value={empresa} onChange={setEmpresa} vacio="Elige empresa…" />
        <span className="text-xs text-slate-500">Lo que se captura aquí sale en las declaraciones y la firma de “EL PROVEEDOR”.</span>
      </div>
      {!empresa && <p className="text-sm text-slate-400">Elige una empresa.</p>}
      {empresa && isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {empresa && !isLoading && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            guardar.mutate();
          }}
          className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-3"
        >
          {CAMPOS.map((c) => (
            <label key={c.k} className={`text-xs text-slate-600 ${c.ancho ? "sm:col-span-3" : ""}`}>
              {c.t}
              {c.k === "objeto_social" ? (
                <textarea rows={2} value={f[c.k]} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} disabled={!suscripcionPermiteEscribir} className={inp} />
              ) : (
                <input type={c.tipo ?? "text"} value={f[c.k]} onChange={(e) => setF({ ...f, [c.k]: e.target.value })} disabled={!suscripcionPermiteEscribir} className={inp} placeholder={c.ayuda} />
              )}
            </label>
          ))}
          {suscripcionPermiteEscribir && (
            <div className="flex items-center gap-2 sm:col-span-3">
              <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{guardar.isPending ? "Guardando…" : "Guardar"}</button>
              {msg && <span className={`text-sm ${msg === "Guardado." ? "text-emerald-700" : "text-red-600"}`}>{msg}</span>}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
