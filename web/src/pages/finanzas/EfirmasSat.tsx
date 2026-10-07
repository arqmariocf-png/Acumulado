import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { diasParaVencer, estadoEfirma, ETIQUETA_ESTADO, revisarArchivos, type EstadoEfirma } from "../../lib/efirmaSat";

// e.firma del SAT por empresa (Mario, 7-oct-2026: "haz la pantalla para
// subirlas y dale acceso a Belén"). La usa la descarga masiva automática de
// CFDI. Suben admin y contabilidad (permiso por persona); la contraseña se
// guarda cifrada y nunca regresa al navegador.

interface Empresa {
  id: string;
  codigo: string;
  nombre: string;
  rfc: string | null;
  activo: boolean;
}

interface Efirma {
  empresa_id: string;
  rfc: string;
  titular: string | null;
  numero_certificado: string | null;
  vigente_hasta: string | null;
  subido_por_nombre: string | null;
  updated_at: string;
  ultima_descarga_en: string | null;
  ultimo_error: string | null;
}

const COLOR: Record<EstadoEfirma, string> = {
  sin_efirma: "bg-slate-100 text-slate-600",
  vencida: "bg-red-100 text-red-800",
  por_vencer: "bg-amber-100 text-amber-800",
  vigente: "bg-emerald-100 text-emerald-800",
};

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

async function llamar(metodo: "POST" | "DELETE", cuerpo: FormData | null, empresa?: string) {
  const { data: sesion } = await supabase.auth.getSession();
  const base = urlFuncion("sat-efirma");
  const resp = await fetch(metodo === "DELETE" ? `${base}?empresa=${encodeURIComponent(empresa ?? "")}` : base, {
    method: metodo,
    headers: { Authorization: `Bearer ${sesion.session?.access_token}` },
    body: cuerpo ?? undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
  return json as { rfc?: string; vigente_hasta?: string; rfc_nuevo_en_empresa?: boolean };
}

export function EfirmasSat() {
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sat-efirmas"],
    queryFn: async () => {
      const [emp, ef] = await Promise.all([
        supabase.from("empresas").select("id, codigo, nombre, rfc, activo").eq("activo", true).order("codigo"),
        supabase.from("sat_efirmas").select("empresa_id, rfc, titular, numero_certificado, vigente_hasta, subido_por_nombre, updated_at, ultima_descarga_en, ultimo_error"),
      ]);
      if (emp.error) throw emp.error;
      if (ef.error) throw ef.error;
      return { empresas: (emp.data ?? []) as Empresa[], efirmas: new Map(((ef.data ?? []) as Efirma[]).map((e) => [e.empresa_id, e])) };
    },
  });

  const subir = useMutation({
    mutationFn: async ({ empresa, fd }: { empresa: Empresa; fd: FormData }) => {
      const cer = fd.get("cer") as File | null;
      const key = fd.get("key") as File | null;
      const password = String(fd.get("password") ?? "");
      const problema = revisarArchivos(cer && cer.size ? cer : null, key && key.size ? key : null, password);
      if (problema) throw new Error(problema);
      fd.set("empresaId", empresa.id);
      return { empresa, r: await llamar("POST", fd) };
    },
    onSuccess: ({ empresa, r }) => {
      setAbierta(null);
      setAviso({
        tipo: "ok",
        texto: `e.firma de ${empresa.codigo} guardada (RFC ${r.rfc}, vigente hasta ${fecha(r.vigente_hasta ?? null)}).${r.rfc_nuevo_en_empresa ? " El RFC se registró en la empresa." : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["sat-efirmas"] });
    },
    onError: (e: Error) => setAviso({ tipo: "error", texto: e.message }),
  });

  const quitar = useMutation({
    mutationFn: async (empresa: Empresa) => llamar("DELETE", null, empresa.id),
    onSuccess: () => {
      setAviso({ tipo: "ok", texto: "e.firma retirada." });
      qc.invalidateQueries({ queryKey: ["sat-efirmas"] });
    },
    onError: (e: Error) => setAviso({ tipo: "error", texto: e.message }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>, empresa: Empresa) {
    e.preventDefault();
    setAviso(null);
    const form = e.currentTarget;
    subir.mutate({ empresa, fd: new FormData(form) }, { onSuccess: () => form.reset() });
  }

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>;

  const empresas = data?.empresas ?? [];
  const efirmas = data?.efirmas ?? new Map<string, Efirma>();
  const conEfirma = empresas.filter((e) => efirmas.has(e.id)).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">e.firma del SAT por empresa</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Con la e.firma de cada empresa el sistema baja solo los CFDI emitidos y recibidos del SAT (descarga masiva). Sube el <b>.cer</b>, el <b>.key</b> y la{" "}
          <b>contraseña de la llave privada</b>. Se revisa que sea la e.firma (no el sello de facturas), que esté vigente, que la contraseña abra la llave y que el
          RFC sea el de la empresa. La contraseña se guarda cifrada: nadie la puede volver a ver, ni aquí ni en la base.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {conEfirma} de {empresas.length} empresas con e.firma.
        </p>
      </div>

      {aviso && <p className={`rounded px-3 py-2 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}</p>}

      <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
        {empresas.map((emp) => {
          const ef = efirmas.get(emp.id);
          const estado = estadoEfirma(ef?.vigente_hasta);
          const dias = ef?.vigente_hasta ? diasParaVencer(ef.vigente_hasta) : null;
          return (
            <div key={emp.id} className="p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-12 font-mono text-sm font-semibold text-slate-900">{emp.codigo}</span>
                <span className="min-w-0 flex-1 text-sm text-slate-800">
                  {emp.nombre}
                  <span className="ml-2 text-xs text-slate-500">RFC {emp.rfc || ef?.rfc || "sin capturar"}</span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR[estado]}`}>
                  {ETIQUETA_ESTADO[estado]}
                  {ef && dias !== null && estado !== "vencida" ? ` · hasta ${fecha(ef.vigente_hasta)}` : ""}
                  {estado === "por_vencer" && dias !== null ? ` (${dias} días)` : ""}
                </span>
                <button type="button" onClick={() => { setAviso(null); setAbierta(abierta === emp.id ? null : emp.id); }} className="text-xs font-medium text-slate-700 underline">
                  {abierta === emp.id ? "Cancelar" : ef ? "Reemplazar" : "Subir e.firma"}
                </button>
                {ef && (
                  <button
                    type="button"
                    disabled={quitar.isPending}
                    onClick={() => confirm(`¿Quitar la e.firma de ${emp.codigo}? La descarga automática de esa empresa se detiene.`) && quitar.mutate(emp)}
                    className="text-xs text-red-600 underline disabled:opacity-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {ef && (
                <p className="mt-1 text-xs text-slate-500 sm:pl-[3.75rem]">
                  {ef.titular ?? "—"} · certificado {ef.numero_certificado ?? "—"} · subió {ef.subido_por_nombre ?? "—"} el {fecha(ef.updated_at)}
                  {ef.ultima_descarga_en ? ` · última descarga ${fecha(ef.ultima_descarga_en)}` : ""}
                  {ef.ultimo_error ? <span className="text-red-700"> · {ef.ultimo_error}</span> : null}
                </p>
              )}
              {abierta === emp.id && (
                <form onSubmit={(e) => onSubmit(e, emp)} className="mt-3 grid grid-cols-1 gap-2 rounded bg-slate-50 p-3 sm:grid-cols-4" autoComplete="off">
                  <label className="text-xs text-slate-600">
                    Certificado (.cer)
                    <input name="cer" type="file" accept=".cer" className="mt-1 block w-full text-sm" />
                  </label>
                  <label className="text-xs text-slate-600">
                    Llave privada (.key)
                    <input name="key" type="file" accept=".key" className="mt-1 block w-full text-sm" />
                  </label>
                  <label className="text-xs text-slate-600">
                    Contraseña de la llave
                    <input name="password" type="password" autoComplete="new-password" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                  <div className="flex items-end">
                    <button disabled={subir.isPending} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                      {subir.isPending ? "Revisando…" : "Guardar e.firma"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        Es la e.firma (antes FIEL) de la empresa, no el certificado de sello digital (CSD) que se usa para facturar. Dura 4 años; se marca "por vencer" 60 días
        antes.
      </p>
    </div>
  );
}
