import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import type { FilaPerfilLegal } from "../../lib/contratoCredito";
import {
  docContratoArrendamiento,
  faltantesArrendamiento,
  htmlContratoArrendamiento,
  nombreArchivoArrendamiento,
  parteDesdePerfil,
  PENAS_DEFAULT,
  periodoRenovacion,
  textoPlazo,
  type DatosArrendamiento,
  type ParteArrendamiento,
} from "../../lib/contratoArrendamiento";
import { estadoVencimiento, textoVencimiento } from "../../lib/expedienteLegal";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { DocumentosLegal } from "./DocumentosLegal";
import { fechaCorta } from "./comun";

interface Arrendamiento {
  id: string;
  empresa_id: string;
  papel: "arrendador" | "arrendatario";
  folio: string | null;
  contraparte: string;
  inmueble: string;
  renta: number;
  iva_incluido: boolean;
  inicio: string;
  fin: string;
  fecha_firma: string;
  datos: DatosArrendamiento;
  estatus: "borrador" | "firmado" | "terminado" | "cancelado";
  firmado_en: string | null;
  notas: string | null;
}

const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const hoy = () => new Date().toISOString().slice(0, 10);
const AVISO_DIAS = 60;

function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob(["﻿", contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function abrir(datos: DatosArrendamiento, formato: "imprimir" | "word", ventana?: Window | null) {
  if (formato === "word") descargar(nombreArchivoArrendamiento(datos, "doc"), docContratoArrendamiento(datos), "application/msword");
  else abrirParaImprimir(htmlContratoArrendamiento(datos), ventana ?? abrirVentanaImpresion());
}

async function perfilParte(empresaId: string): Promise<ParteArrendamiento> {
  const [{ data: perfil, error: e1 }, { data: emp, error: e2 }] = await Promise.all([
    supabase.from("empresas_perfil_legal").select("*").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("empresas").select("nombre").eq("id", empresaId).single(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return parteDesdePerfil(perfil as FilaPerfilLegal | null, emp.nombre as string);
}

const COLOR_VENCE: Record<string, string> = {
  vencido: "bg-red-100 text-red-800",
  por_vencer: "bg-amber-100 text-amber-800",
  vigente: "bg-emerald-100 text-emerald-800",
  sin_vencimiento: "bg-slate-100 text-slate-600",
};

/** Contratos de arrendamiento (2-oct-2026): machote del contrato CSC →
 * Ergodinova; nuestra empresa sale de "Datos legales de la empresa", la otra
 * parte se elige del grupo o se captura. Vencimiento con semáforo y
 * "Renovar" para el siguiente periodo. */
export function Arrendamientos() {
  const { suscripcionPermiteEscribir } = useAuth();
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [form, setForm] = useState<{ clave: string; base: DatosArrendamiento | null; empresaId: string; papel: Arrendamiento["papel"] } | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: lista, isLoading, error } = useQuery({
    queryKey: ["legal-arrendamientos", empresa],
    queryFn: async () => {
      let q = supabase.from("legal_arrendamientos").select("*").order("fin", { ascending: true });
      if (empresa) q = q.eq("empresa_id", empresa);
      const { data, error: err } = await q;
      if (err) throw err;
      return (data ?? []) as Arrendamiento[];
    },
  });
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["legal-arrendamientos"] });

  async function estatus(id: string, valor: Arrendamiento["estatus"]) {
    setMsg(null);
    const { error: err } = await supabase.from("legal_arrendamientos").update({ estatus: valor }).eq("id", id);
    if (err) setMsg(err.message);
    else refrescar();
  }
  async function borrar(id: string) {
    if (!confirm("¿Borrar este borrador?")) return;
    const { error: err } = await supabase.from("legal_arrendamientos").delete().eq("id", id);
    if (err) setMsg(err.message);
    else refrescar();
  }

  const hoyIso = hoy();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorEmpresa value={empresa} onChange={setEmpresa} />
        <span className="text-xs text-slate-500">La empresa es la nuestra, sea la que renta (arrendador) o la que ocupa (arrendatario).</span>
        {suscripcionPermiteEscribir && (
          <button
            type="button"
            onClick={() => setForm(form?.clave === "nuevo" ? null : { clave: "nuevo", base: null, empresaId: empresa, papel: "arrendador" })}
            className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            {form?.clave === "nuevo" ? "Cerrar" : "Nuevo arrendamiento"}
          </button>
        )}
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {form && (
        <FormArrendamiento
          key={form.clave}
          base={form.base}
          empresaInicial={form.empresaId}
          papelInicial={form.papel}
          onCerrar={() => setForm(null)}
          onListo={() => {
            setForm(null);
            refrescar();
          }}
        />
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {!isLoading && (lista ?? []).length === 0 && <p className="text-sm text-slate-400">Ningún contrato de arrendamiento en esta empresa.</p>}

      <div className="space-y-2">
        {(lista ?? []).map((r) => {
          const activo = r.estatus === "borrador" || r.estatus === "firmado";
          const v = activo ? estadoVencimiento(r.fin, hoyIso, AVISO_DIAS) : { estado: "sin_vencimiento" as const, dias: null };
          return (
            <div key={r.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-500">{r.folio}</span> · {r.papel === "arrendador" ? "Rentamos a" : "Nos renta"} {r.contraparte}
                  </div>
                  <div className="text-xs text-slate-500">{r.inmueble}</div>
                  <div className="text-xs text-slate-500">
                    {fechaCorta(r.inicio)} → {fechaCorta(r.fin)} · {textoPlazo(r.inicio, r.fin)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{moneda(Number(r.renta))}</div>
                  <div className="text-xs text-slate-500">mensual {r.iva_incluido ? "IVA incluido" : "+ IVA"}</div>
                </div>
                <div className="flex w-full flex-wrap gap-1 sm:w-auto sm:flex-col sm:items-end">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${r.estatus === "firmado" ? "bg-emerald-100 text-emerald-800" : r.estatus === "borrador" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"}`}>
                    {r.estatus === "firmado" ? `firmado${r.firmado_en ? ` ${fechaCorta(r.firmado_en)}` : ""}` : r.estatus}
                  </span>
                  {activo && <span className={`rounded px-1.5 py-0.5 text-xs ${COLOR_VENCE[v.estado]}`}>{textoVencimiento(r.fin, hoyIso).replace("vencido", "venció").replace(" d", " días")}</span>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <button type="button" onClick={() => abrir({ ...r.datos, folio: r.folio }, "imprimir")} className="text-sky-700 hover:underline">Imprimir</button>
                <button type="button" onClick={() => abrir({ ...r.datos, folio: r.folio }, "word")} className="text-sky-700 hover:underline">Word</button>
                {suscripcionPermiteEscribir && r.estatus === "borrador" && (
                  <>
                    <button type="button" onClick={() => estatus(r.id, "firmado")} className="text-emerald-700 hover:underline">Marcar firmado</button>
                    <button type="button" onClick={() => borrar(r.id)} className="text-red-600 hover:underline">Borrar</button>
                  </>
                )}
                {suscripcionPermiteEscribir && r.estatus === "firmado" && (
                  <button type="button" onClick={() => confirm("¿Dar por terminado este arrendamiento?") && estatus(r.id, "terminado")} className="text-slate-600 hover:underline">Terminado</button>
                )}
                {suscripcionPermiteEscribir && (r.estatus === "firmado" || r.estatus === "terminado") && (
                  <button
                    type="button"
                    onClick={() => {
                      const p = periodoRenovacion(r.inicio, r.fin);
                      setForm({ clave: `renovar-${r.id}`, base: { ...r.datos, folio: null, inicio: p.inicio, fin: p.fin, fecha_firma: p.inicio }, empresaId: r.empresa_id, papel: r.papel });
                    }}
                    className="text-slate-900 hover:underline"
                  >
                    Renovar
                  </button>
                )}
                <button type="button" onClick={() => setAbierto(abierto === r.id ? null : r.id)} className="text-slate-600 hover:underline">
                  {abierto === r.id ? "ocultar escaneado" : "escaneado firmado"}
                </button>
              </div>
              {abierto === r.id && (
                <div className="mt-2 rounded bg-slate-50 p-2">
                  <DocumentosLegal destino={{ arrendamiento: r.id }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PARTE_VACIA: ParteArrendamiento = { tipo_persona: "moral", razon_social: "", rfc: null, representante: null, cargo: null, domicilio: null };

function CamposParte({ titulo, parte, onChange }: { titulo: string; parte: ParteArrendamiento; onChange: (p: ParteArrendamiento) => void }) {
  const set = (k: keyof ParteArrendamiento, v: string) => onChange({ ...parte, [k]: k === "tipo_persona" || k === "razon_social" ? v : v || null });
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <div className="text-xs font-semibold uppercase text-slate-500 sm:col-span-4">{titulo}</div>
      <label className="text-xs text-slate-600">Persona
        <select value={parte.tipo_persona} onChange={(e) => set("tipo_persona", e.target.value)} className={inp}>
          <option value="moral">Moral (empresa)</option>
          <option value="fisica">Física</option>
        </select>
      </label>
      <label className="text-xs text-slate-600 sm:col-span-2">{parte.tipo_persona === "moral" ? "Razón social" : "Nombre"}<input value={parte.razon_social} onChange={(e) => set("razon_social", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">RFC<input value={parte.rfc ?? ""} onChange={(e) => set("rfc", e.target.value.toUpperCase())} className={inp} /></label>
      {parte.tipo_persona === "moral" && (
        <>
          <label className="text-xs text-slate-600 sm:col-span-2">Representante<input value={parte.representante ?? ""} onChange={(e) => set("representante", e.target.value)} className={inp} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Cargo<input value={parte.cargo ?? ""} onChange={(e) => set("cargo", e.target.value)} className={inp} placeholder="ADMINISTRADOR ÚNICO" /></label>
        </>
      )}
      <label className="text-xs text-slate-600 sm:col-span-4">Domicilio fiscal<input value={parte.domicilio ?? ""} onChange={(e) => set("domicilio", e.target.value)} className={inp} /></label>
    </div>
  );
}

function FormArrendamiento({
  base,
  empresaInicial,
  papelInicial,
  onCerrar,
  onListo,
}: {
  base: DatosArrendamiento | null;
  empresaInicial: string;
  papelInicial: Arrendamiento["papel"];
  onCerrar: () => void;
  onListo: () => void;
}) {
  const { perfil } = useAuth();
  const { data: empresas } = useEmpresasAlcance();
  const [empresa, setEmpresa] = useState(empresaInicial || perfil?.empresa_id || "");
  const [papel, setPapel] = useState<Arrendamiento["papel"]>(papelInicial);
  const [nuestra, setNuestra] = useState<ParteArrendamiento>(base ? (papelInicial === "arrendador" ? base.arrendador : base.arrendatario) : PARTE_VACIA);
  const [otra, setOtra] = useState<ParteArrendamiento>(base ? (papelInicial === "arrendador" ? base.arrendatario : base.arrendador) : PARTE_VACIA);
  const [conFiador, setConFiador] = useState(!!base?.fiador);
  const [fiador, setFiador] = useState(base?.fiador ?? { nombre: "", domicilio: null as string | null });
  const [d, setD] = useState({
    domicilio: base?.inmueble.domicilio ?? "",
    metros: base?.inmueble.metros != null ? String(base.inmueble.metros) : "",
    uso: base?.inmueble.uso ?? "",
    renta: base ? String(base.renta) : "",
    iva_incluido: base?.iva_incluido ?? true,
    dia_pago: String(base?.dia_pago ?? 1),
    forma_pago: base?.forma_pago ?? ("transferencia" as DatosArrendamiento["forma_pago"]),
    inicio: base?.inicio ?? "",
    fin: base?.fin ?? "",
    pena_atraso_pct: String(base?.pena_atraso_pct ?? PENAS_DEFAULT.pena_atraso_pct),
    pena_cheque_pct: String(base?.pena_cheque_pct ?? PENAS_DEFAULT.pena_cheque_pct),
    aumento_no_desocupa_pct: String(base?.aumento_no_desocupa_pct ?? PENAS_DEFAULT.aumento_no_desocupa_pct),
    exclusividad_giro: base?.exclusividad_giro ?? false,
    ciudad_firma: base?.ciudad_firma ?? "Puebla, Pue.",
    fecha_firma: base?.fecha_firma ?? hoy(),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof d, v: string | boolean) => setD((x) => ({ ...x, [k]: v }));

  async function llenarNuestra(id: string) {
    setEmpresa(id);
    if (!id) return;
    try {
      setNuestra(await perfilParte(id));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function llenarOtra(id: string) {
    if (!id) return;
    try {
      setOtra(await perfilParte(id));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const datos: DatosArrendamiento = {
    folio: null,
    arrendador: papel === "arrendador" ? nuestra : otra,
    arrendatario: papel === "arrendador" ? otra : nuestra,
    fiador: conFiador && fiador.nombre.trim() ? { nombre: fiador.nombre.trim(), domicilio: fiador.domicilio?.trim() || null } : null,
    inmueble: { domicilio: d.domicilio.trim(), metros: d.metros ? Number(d.metros) : null, uso: d.uso.trim() },
    renta: Number(d.renta) || 0,
    iva_incluido: d.iva_incluido,
    dia_pago: Math.min(Math.max(Number(d.dia_pago) || 1, 1), 31),
    forma_pago: d.forma_pago,
    inicio: d.inicio,
    fin: d.fin,
    pena_atraso_pct: Number(d.pena_atraso_pct) || 0,
    pena_cheque_pct: Number(d.pena_cheque_pct) || 0,
    aumento_no_desocupa_pct: Number(d.aumento_no_desocupa_pct) || 0,
    exclusividad_giro: d.exclusividad_giro,
    ciudad_firma: d.ciudad_firma.trim() || "Puebla, Pue.",
    fecha_firma: d.fecha_firma || hoy(),
  };
  const faltan = faltantesArrendamiento(datos);
  const bloqueantes = faltan.filter((f) => /Renta|Inicio|fecha de fin|Domicilio del inmueble|Uso o giro|Nombre o razón social/.test(f));

  const generar = useMutation({
    mutationFn: async ({ formato, ventana }: { formato: "imprimir" | "word"; ventana: Window | null }) => {
      if (!empresa) throw new Error("Elige nuestra empresa");
      if (bloqueantes.length) throw new Error(`Falta: ${bloqueantes.join(" · ")}`);
      const { data, error } = await supabase
        .from("legal_arrendamientos")
        .insert({
          empresa_id: empresa,
          papel,
          contraparte: otra.razon_social.trim(),
          inmueble: datos.inmueble.domicilio,
          renta: datos.renta,
          iva_incluido: datos.iva_incluido,
          inicio: datos.inicio,
          fin: datos.fin,
          fecha_firma: datos.fecha_firma,
          datos,
        })
        .select("id, folio")
        .single();
      if (error) {
        ventana?.close();
        throw error;
      }
      const final = { ...datos, folio: data.folio as string };
      await supabase.from("legal_arrendamientos").update({ datos: final }).eq("id", data.id);
      abrir(final, formato, ventana);
    },
    onSuccess: onListo,
    onError: (e) => setMsg((e as Error).message),
  });

  // Contrato nuevo: nuestra empresa se llena sola con sus datos legales.
  useEffect(() => {
    if (base || !empresaInicial) return;
    let vigente = true;
    perfilParte(empresaInicial)
      .then((p) => vigente && setNuestra(p))
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [base, empresaInicial]);

  const otrasEmpresas = (empresas ?? []).filter((e) => e.id !== empresa);
  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-800">{base ? "Renovar arrendamiento" : "Nuevo contrato de arrendamiento"}</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-slate-600">Nuestra empresa<SelectorEmpresa value={empresa} onChange={llenarNuestra} vacio="Elige empresa…" className={inp} required /></label>
        <label className="text-xs text-slate-600">Nuestro papel
          <select value={papel} onChange={(e) => setPapel(e.target.value as Arrendamiento["papel"])} className={inp}>
            <option value="arrendador">Arrendador (rentamos nuestro inmueble)</option>
            <option value="arrendatario">Arrendatario (nos rentan)</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">La otra parte es una empresa del grupo
          <select value="" onChange={(e) => llenarOtra(e.target.value)} className={inp}>
            <option value="">— capturar a mano —</option>
            {otrasEmpresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
      </div>
      {empresa && !nuestra.razon_social && (
        <button type="button" onClick={() => llenarNuestra(empresa)} className="text-xs text-sky-700 hover:underline">Llenar con los datos legales de nuestra empresa</button>
      )}
      <CamposParte titulo={`Nosotros (${papel})`} parte={nuestra} onChange={setNuestra} />
      <CamposParte titulo={`La otra parte (${papel === "arrendador" ? "arrendatario" : "arrendador"})`} parte={otra} onChange={setOtra} />

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="text-xs font-semibold uppercase text-slate-500 sm:col-span-4">Inmueble</div>
        <label className="text-xs text-slate-600 sm:col-span-3">Domicilio del inmueble<input value={d.domicilio} onChange={(e) => set("domicilio", e.target.value)} className={inp} placeholder="Prolongación 13 Oriente 1823, San Bernardino Tlaxcalancingo, San Andrés Cholula, C.P. 72820" /></label>
        <label className="text-xs text-slate-600">Metros cuadrados<input type="number" min="0" value={d.metros} onChange={(e) => set("metros", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600 sm:col-span-3">Uso o giro<input value={d.uso} onChange={(e) => set("uso", e.target.value)} className={inp} placeholder="bodega y oficinas" /></label>
        <label className="flex items-end gap-1 text-xs text-slate-600"><input type="checkbox" checked={d.exclusividad_giro} onChange={(e) => set("exclusividad_giro", e.target.checked)} /> El arrendador no renta otro local con el mismo giro</label>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="text-xs font-semibold uppercase text-slate-500 sm:col-span-4">Renta y plazo</div>
        <label className="text-xs text-slate-600">Renta mensual<input type="number" step="0.01" min="0" value={d.renta} onChange={(e) => set("renta", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">IVA
          <select value={d.iva_incluido ? "si" : "no"} onChange={(e) => set("iva_incluido", e.target.value === "si")} className={inp}>
            <option value="si">IVA incluido</option>
            <option value="no">Más IVA</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Día de pago<input type="number" min="1" max="31" value={d.dia_pago} onChange={(e) => set("dia_pago", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Forma de pago
          <select value={d.forma_pago} onChange={(e) => set("forma_pago", e.target.value)} className={inp}>
            <option value="transferencia">Transferencia</option>
            <option value="deposito">Depósito</option>
            <option value="efectivo">Efectivo</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Inicio<input type="date" value={d.inicio} onChange={(e) => set("inicio", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Fin (vencimiento)<input type="date" value={d.fin} onChange={(e) => set("fin", e.target.value)} className={inp} /></label>
        <div className="flex items-end text-xs text-slate-500 sm:col-span-2">{d.inicio && d.fin && d.fin > d.inicio ? `Plazo: ${textoPlazo(d.inicio, d.fin)}` : ""}</div>
        <label className="text-xs text-slate-600">% por pago tardío<input type="number" min="0" value={d.pena_atraso_pct} onChange={(e) => set("pena_atraso_pct", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">% cheque devuelto<input type="number" min="0" value={d.pena_cheque_pct} onChange={(e) => set("pena_cheque_pct", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">% aumento si no desocupa<input type="number" min="0" value={d.aumento_no_desocupa_pct} onChange={(e) => set("aumento_no_desocupa_pct", e.target.value)} className={inp} /></label>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="flex items-center gap-1 text-xs text-slate-600 sm:col-span-4"><input type="checkbox" checked={conFiador} onChange={(e) => setConFiador(e.target.checked)} /> Con fiador</label>
        {conFiador && (
          <>
            <label className="text-xs text-slate-600">Nombre del fiador<input value={fiador.nombre} onChange={(e) => setFiador({ ...fiador, nombre: e.target.value })} className={inp} /></label>
            <label className="text-xs text-slate-600 sm:col-span-3">Domicilio del fiador<input value={fiador.domicilio ?? ""} onChange={(e) => setFiador({ ...fiador, domicilio: e.target.value })} className={inp} /></label>
          </>
        )}
        <label className="text-xs text-slate-600 sm:col-span-2">Ciudad de firma<input value={d.ciudad_firma} onChange={(e) => set("ciudad_firma", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Fecha de firma<input type="date" value={d.fecha_firma} onChange={(e) => set("fecha_firma", e.target.value)} className={inp} /></label>
      </div>

      {faltan.length > 0 && <p className="text-xs text-amber-800">Falta capturar (saldrá en blanco “____”): {faltan.join(" · ")}.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={bloqueantes.length > 0} onClick={() => abrir(datos, "imprimir")} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Vista previa</button>
        <button type="button" disabled={generar.isPending} onClick={() => generar.mutate({ formato: "imprimir", ventana: bloqueantes.length ? null : abrirVentanaImpresion() })} className="rounded bg-slate-900 px-2.5 py-1.5 text-xs text-white disabled:opacity-50">Generar e imprimir</button>
        <button type="button" disabled={generar.isPending} onClick={() => generar.mutate({ formato: "word", ventana: null })} className="rounded bg-slate-700 px-2.5 py-1.5 text-xs text-white disabled:opacity-50">Generar en Word</button>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500">cancelar</button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>
    </div>
  );
}
