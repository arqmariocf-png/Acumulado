import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { FacturarOrden } from "../../components/FacturarOrden";
import { rutaVerArchivo } from "../../lib/verArchivo";
import { MOTIVOS_CANCELACION, REGIMENES_FISCALES } from "../../lib/facturacion";

// Contabilidad › Facturación (23-nov-2026, Mario: "conexión con factura.com
// para que las órdenes de venta se agreguen de inmediato y podamos facturar
// con un clic"). Por empresa: conexión con factura.com (entorno, llaves de
// la API que se guardan cifradas y nunca regresan, serie con la que se
// timbra, régimen, C.P. de expedición), las OV sin factura con su botón
// "Facturar" y las facturas emitidas (PDF, XML, reenviar, cancelar).

const dinero = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface Config {
  empresa_id: string;
  entorno: "sandbox" | "produccion";
  api_key_secret_id: string | null;
  secret_key_secret_id: string | null;
  serie_id: number | null;
  serie_nombre: string | null;
  regimen_fiscal: string | null;
  lugar_expedicion: string | null;
  enviar_correo: boolean;
  clave_prod_serv_default: string | null;
  clave_unidad_default: string;
  probado_en: string | null;
  actualizado_por_nombre: string | null;
  updated_at: string;
}
interface Serie {
  id: number;
  nombre: string;
  tipo: string;
  descripcion: string | null;
  activa: boolean;
}
interface Factura {
  id: string;
  empresa_id: string;
  orden_venta_id: string | null;
  entorno: string;
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  rfc_receptor: string | null;
  nombre_receptor: string | null;
  total: number | null;
  estado: "timbrada" | "cancelada" | "error";
  mensaje: string | null;
  created_at: string;
  creado_por_nombre: string | null;
  cancelada_en: string | null;
  cancelacion_motivo: string | null;
  ordenes_venta?: { id_ov: string } | null;
}
interface OvSinFactura {
  id: string;
  id_ov: string;
  empresa_id: string;
  cliente: string | null;
  total: number | null;
  fecha_ov: string | null;
  proyecto: string | null;
}

async function llamar(cuerpo: Record<string, unknown>) {
  const { data: ses } = await supabase.auth.getSession();
  const resp = await fetch(urlFuncion("facturacion-factura-com"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ses.session?.access_token}` }, body: JSON.stringify(cuerpo) });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw await errorDeFuncion(resp, json);
  return json as Record<string, unknown>;
}

export function Facturacion() {
  const qc = useQueryClient();
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const { data: empresas } = useEmpresasAlcance();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [facturando, setFacturando] = useState<string | null>(null);
  const ok = (t: string) => setAviso({ tipo: "ok", texto: t });
  const falla = (e: Error) => setAviso({ tipo: "error", texto: e.message });

  const configs = useQuery({
    queryKey: ["facturacion-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("facturacion_config").select("*");
      if (error) throw error;
      return (data ?? []) as Config[];
    },
  });
  const facturas = useQuery({
    queryKey: ["facturas-emitidas", empresaId],
    queryFn: async () => {
      let q = supabase.from("facturas_emitidas").select("id, empresa_id, orden_venta_id, entorno, uuid, serie, folio, rfc_receptor, nombre_receptor, total, estado, mensaje, created_at, creado_por_nombre, cancelada_en, cancelacion_motivo, ordenes_venta(id_ov)").order("created_at", { ascending: false }).limit(300);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Factura[];
    },
  });
  const porFacturar = useQuery({
    queryKey: ["ov-sin-factura", empresaId],
    queryFn: async () => {
      let q = supabase.from("ordenes_venta").select("id, id_ov, empresa_id, cliente, total, fecha_ov, proyecto").eq("fuente", "acumulado").is("cancelada_en", null).order("fecha_ov", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw error;
      const { data: hechas } = await supabase.from("facturas_emitidas").select("orden_venta_id").eq("estado", "timbrada");
      const ya = new Set((hechas ?? []).map((x) => x.orden_venta_id as string));
      return ((data ?? []) as OvSinFactura[]).filter((o) => !ya.has(o.id));
    },
  });

  const empresasVisibles = useMemo(() => (empresas ?? []).filter((e) => !empresaId || e.id === empresaId), [empresas, empresaId]);
  const codigo = (id: string) => empresas?.find((e) => e.id === id)?.codigo ?? "—";
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["facturacion-config"] });
    qc.invalidateQueries({ queryKey: ["facturas-emitidas"] });
    qc.invalidateQueries({ queryKey: ["ov-sin-factura"] });
  };

  async function reenviar(f: Factura) {
    try {
      const r = await llamar({ accion: "reenviar", factura_id: f.id });
      ok(String(r.mensaje ?? "Factura reenviada."));
    } catch (e) {
      falla(e as Error);
    }
  }
  async function cancelar(f: Factura) {
    const motivo = window.prompt(`Motivo de cancelación del SAT para ${[f.serie, f.folio].filter(Boolean).join(" ")}:\n${MOTIVOS_CANCELACION.map((m) => m.etiqueta).join("\n")}\n\nEscribe la clave (01-04):`, "02");
    if (!motivo) return;
    let sustituto = "";
    if (motivo.trim() === "01") {
      sustituto = window.prompt("UUID de la factura que la sustituye:", "") ?? "";
      if (!sustituto.trim()) return;
    }
    if (!window.confirm(`¿Cancelar ante el SAT la factura ${f.uuid}? Esto no se deshace.`)) return;
    try {
      const r = await llamar({ accion: "cancelar", factura_id: f.id, motivo: motivo.trim(), folio_sustituto: sustituto.trim() || null });
      ok(String(r.mensaje ?? "Factura cancelada."));
      refrescar();
    } catch (e) {
      falla(e as Error);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Facturación (factura.com)</h1>
        <p className="text-sm text-slate-500">
          Conecta cada empresa con su cuenta de factura.com una sola vez (API key y secret key de Configuraciones › API; se guardan cifradas y no vuelven a mostrarse). Después, cada orden de venta se factura con un clic desde aquí o desde Órdenes; el CFDI entra solo a cuentas por cobrar y conciliación.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        {aviso && <span className={`rounded px-3 py-1.5 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{aviso.texto}</span>}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Conexión por empresa</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {empresasVisibles.map((e) => (
            <TarjetaEmpresa key={e.id} empresa={e} config={configs.data?.find((c) => c.empresa_id === e.id) ?? null} onOk={(m) => { ok(m); refrescar(); }} onError={falla} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Órdenes de venta sin factura ({porFacturar.data?.length ?? 0})</h2>
        {porFacturar.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {porFacturar.data && porFacturar.data.length === 0 && <p className="text-sm text-slate-500">Todas las órdenes de venta capturadas aquí tienen factura.</p>}
        {porFacturar.data && porFacturar.data.length > 0 && (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Folio</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Proyecto</th>
                  <th className="px-3 py-2 text-right">Total c/IVA</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {porFacturar.data.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{o.id_ov}</td>
                    <td className="px-3 py-2 text-xs">{o.fecha_ov ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{codigo(o.empresa_id)}</td>
                    <td className="px-3 py-2">{o.cliente ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{o.proyecto ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dinero(o.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setFacturando(o.id)} className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white">
                        Facturar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Facturas emitidas desde aquí ({facturas.data?.length ?? 0})</h2>
        {facturas.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {facturas.error && <p className="text-sm text-red-700">{(facturas.error as Error).message}</p>}
        {facturas.data && facturas.data.length === 0 && <p className="text-sm text-slate-500">Todavía no se ha timbrado ninguna factura.</p>}
        {facturas.data && facturas.data.length > 0 && (
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Serie / folio</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">OV</th>
                  <th className="px-3 py-2">Receptor</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {facturas.data.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{[f.serie, f.folio].filter(Boolean).join(" ") || "—"}</div>
                      <div className="font-mono text-[10px] text-slate-400" title={f.uuid ?? ""}>
                        {f.uuid ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {fechaHora(f.created_at)}
                      <div className="text-[10px] text-slate-400">{f.creado_por_nombre ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {codigo(f.empresa_id)}
                      {f.entorno === "sandbox" && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">sandbox</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{f.ordenes_venta?.id_ov ?? "—"}</td>
                    <td className="px-3 py-2">
                      {f.nombre_receptor ?? "—"}
                      <div className="font-mono text-[10px] text-slate-500">{f.rfc_receptor ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{dinero(f.total)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${f.estado === "timbrada" ? "bg-emerald-100 text-emerald-800" : f.estado === "cancelada" ? "bg-slate-200 text-slate-700" : "bg-red-100 text-red-800"}`}>{f.estado}</span>
                      {f.estado === "error" && f.mensaje && <div className="mt-1 max-w-xs text-[11px] text-red-700">{f.mensaje}</div>}
                      {f.estado === "cancelada" && <div className="mt-1 text-[11px] text-slate-500">motivo {f.cancelacion_motivo}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {f.estado !== "error" && (
                        <div className="flex flex-wrap justify-end gap-1 text-xs">
                          <a href={rutaVerArchivo("factura", f.id)} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-2 py-1 text-slate-700">
                            PDF
                          </a>
                          <a href={rutaVerArchivo("factura", `${f.id}:xml`, { descargar: `${f.uuid ?? f.id}.xml` })} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-2 py-1 text-slate-700">
                            XML
                          </a>
                          {f.estado === "timbrada" && (
                            <>
                              <button type="button" onClick={() => reenviar(f)} className="rounded border border-slate-300 px-2 py-1 text-slate-700">
                                Reenviar
                              </button>
                              <button type="button" onClick={() => cancelar(f)} className="rounded border border-red-200 px-2 py-1 text-red-700">
                                Cancelar
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {facturando && <FacturarOrden ovId={facturando} onCerrar={() => setFacturando(null)} onFacturada={refrescar} />}
    </div>
  );
}

function TarjetaEmpresa({ empresa, config, onOk, onError }: { empresa: { id: string; codigo: string; nombre: string }; config: Config | null; onOk: (m: string) => void; onError: (e: Error) => void }) {
  const [editarLlaves, setEditarLlaves] = useState(false);
  const [entorno, setEntorno] = useState<"sandbox" | "produccion">(config?.entorno ?? "sandbox");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [series, setSeries] = useState<Serie[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    serie_id: config?.serie_id ? String(config.serie_id) : "",
    regimen_fiscal: config?.regimen_fiscal ?? "601",
    lugar_expedicion: config?.lugar_expedicion ?? "",
    enviar_correo: config?.enviar_correo ?? true,
    clave_prod_serv_default: config?.clave_prod_serv_default ?? "",
    clave_unidad_default: config?.clave_unidad_default ?? "H87",
  });
  const conLlaves = !!config?.api_key_secret_id && !!config?.secret_key_secret_id;

  async function guardarLlaves(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await llamar({ accion: "credenciales", empresa_id: empresa.id, entorno, api_key: apiKey.trim(), secret_key: secretKey.trim() });
      setSeries((r.series as Serie[]) ?? []);
      setApiKey("");
      setSecretKey("");
      setEditarLlaves(false);
      onOk(`Llaves de ${empresa.codigo} guardadas (${entorno}). Ahora elige la serie con la que se timbra.`);
    } catch (err) {
      onError(err as Error);
    } finally {
      setGuardando(false);
    }
  }
  async function cargarSeries() {
    setGuardando(true);
    try {
      const r = await llamar({ accion: "series", empresa_id: empresa.id });
      setSeries((r.series as Serie[]) ?? []);
    } catch (err) {
      onError(err as Error);
    } finally {
      setGuardando(false);
    }
  }
  async function guardarConfig(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const serie = series?.find((s) => String(s.id) === form.serie_id);
      const fila = {
        empresa_id: empresa.id,
        serie_id: form.serie_id ? Number(form.serie_id) : null,
        serie_nombre: serie?.nombre ?? (form.serie_id ? config?.serie_nombre ?? null : null),
        regimen_fiscal: form.regimen_fiscal || null,
        lugar_expedicion: form.lugar_expedicion.trim() || null,
        enviar_correo: form.enviar_correo,
        clave_prod_serv_default: form.clave_prod_serv_default.trim() || null,
        clave_unidad_default: form.clave_unidad_default.trim().toUpperCase() || "H87",
      };
      const { error } = config ? await supabase.from("facturacion_config").update(fila).eq("empresa_id", empresa.id) : await supabase.from("facturacion_config").insert({ ...fila, entorno });
      if (error) throw error;
      onOk(`Configuración de ${empresa.codigo} guardada.`);
    } catch (err) {
      onError(err as Error);
    } finally {
      setGuardando(false);
    }
  }
  async function quitar() {
    if (!window.confirm(`¿Quitar las llaves de factura.com de ${empresa.codigo}? Ya no se podrá facturar hasta volver a capturarlas.`)) return;
    try {
      await llamar({ accion: "quitar", empresa_id: empresa.id });
      onOk(`Llaves de ${empresa.codigo} quitadas.`);
    } catch (err) {
      onError(err as Error);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">
            {empresa.codigo} · {empresa.nombre}
          </div>
          <div className="text-xs text-slate-500">
            {conLlaves ? (
              <>
                Conectada en <b className={config?.entorno === "produccion" ? "text-emerald-700" : "text-amber-700"}>{config?.entorno === "produccion" ? "PRODUCCIÓN" : "sandbox (pruebas)"}</b>
                {config?.serie_nombre ? ` · serie ${config.serie_nombre}` : " · falta elegir la serie"}
                {config?.actualizado_por_nombre ? ` · ${config.actualizado_por_nombre}` : ""}
              </>
            ) : (
              "Sin conectar: captura la API key y el secret key de su cuenta de factura.com."
            )}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => setEditarLlaves((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-slate-700">
            {conLlaves ? "Cambiar llaves" : "Conectar"}
          </button>
          {conLlaves && (
            <button type="button" onClick={quitar} className="rounded border border-red-200 px-2 py-1 text-red-700">
              Quitar
            </button>
          )}
        </div>
      </div>

      {editarLlaves && (
        <form onSubmit={guardarLlaves} className="mb-3 grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3" data-sin-borrador>
          <label className="text-xs text-slate-600">
            Entorno
            <select value={entorno} onChange={(e) => setEntorno(e.target.value as "sandbox" | "produccion")} className={campo}>
              <option value="sandbox">Sandbox (pruebas, sin validez fiscal)</option>
              <option value="produccion">Producción (timbra de verdad)</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            F-Api-Key
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={`${campo} font-mono`} autoComplete="off" required />
          </label>
          <label className="text-xs text-slate-600">
            F-Secret-Key
            <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className={`${campo} font-mono`} autoComplete="new-password" required />
          </label>
          <div className="flex items-center gap-2 sm:col-span-3">
            <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {guardando ? "Probando…" : "Probar y guardar"}
            </button>
            <span className="text-[11px] text-slate-500">Las llaves de sandbox y producción son distintas (Configuraciones › API en cada sitio). Se prueban contra factura.com antes de guardarse.</span>
          </div>
        </form>
      )}

      {conLlaves && (
        <form onSubmit={guardarConfig} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate-600 lg:col-span-3">
            Serie con la que se timbra *
            <div className="flex gap-2">
              {series ? (
                <select value={form.serie_id} onChange={(e) => setForm({ ...form, serie_id: e.target.value })} className={campo}>
                  <option value="">Elige…</option>
                  {series
                    .filter((s) => s.tipo === "factura" || s.tipo === "")
                    .map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.nombre} · {s.descripcion ?? s.tipo} {s.activa ? "" : "(inactiva)"} · id {s.id}
                      </option>
                    ))}
                </select>
              ) : (
                <input value={config?.serie_nombre ? `${config.serie_nombre} (id ${config.serie_id})` : form.serie_id} readOnly className={`${campo} bg-slate-50`} placeholder="Carga las series de la cuenta" />
              )}
              <button type="button" onClick={cargarSeries} disabled={guardando} className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">
                {guardando ? "…" : "Cargar series"}
              </button>
            </div>
          </label>
          <label className="text-xs text-slate-600">
            Régimen fiscal del emisor
            <select value={form.regimen_fiscal} onChange={(e) => setForm({ ...form, regimen_fiscal: e.target.value })} className={campo}>
              {REGIMENES_FISCALES.map((r) => (
                <option key={r.clave} value={r.clave}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            C.P. de expedición (opcional)
            <input value={form.lugar_expedicion} onChange={(e) => setForm({ ...form, lugar_expedicion: e.target.value.replace(/\D/g, "").slice(0, 5) })} className={`${campo} font-mono`} placeholder="el de la cuenta" />
          </label>
          <label className="text-xs text-slate-600">
            Clave SAT por defecto para partidas sin clave
            <input value={form.clave_prod_serv_default} onChange={(e) => setForm({ ...form, clave_prod_serv_default: e.target.value.replace(/\D/g, "").slice(0, 8) })} className={`${campo} font-mono`} placeholder="01010101 (no existe en el catálogo)" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.enviar_correo} onChange={(e) => setForm({ ...form, enviar_correo: e.target.checked })} /> enviar la factura por correo al cliente al timbrar
          </label>
          <div className="flex items-center gap-2 lg:col-span-2">
            <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Guardar configuración
            </button>
            {config?.probado_en && <span className="text-[11px] text-slate-500">Llaves probadas {fechaHora(config.probado_en)}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
