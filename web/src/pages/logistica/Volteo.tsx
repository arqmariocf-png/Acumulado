import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { descargarCsv } from "../../lib/descargarArchivo";
import { membreteEmpresa } from "../ordenes/datosImpresion";
import type { Unidad } from "../../lib/logistica";
import {
  CLASE_ESTADO_VIAJE,
  ETIQUETA_ESTADO_VIAJE,
  MATERIALES_SUGERIDOS,
  TIPOS_GASTO,
  TIPOS_VIAJE,
  UNIDADES_MEDIDA,
  csvGastos,
  csvViajes,
  enPeriodo,
  filtrarViajes,
  htmlBitacoraViajes,
  htmlManifiestoResiduos,
  importeViaje,
  kmViaje,
  periodoMes,
  porMes,
  resumenPorUnidad,
  revisarGasto,
  revisarViaje,
  totalesResumen,
  type Gasto,
  type Viaje,
} from "../../lib/volteo";

// Camiones de volteo (23-nov-2026, Mario: "vamos a hacer el módulo para los
// camiones de volteo"). Tres pestañas dentro de Logística: Viajes (cada
// salida con cliente/obra, trayecto, material, cantidad, precio, cobro, km y
// manifiesto para residuos), Gastos por unidad (diésel, mantenimiento,
// casetas…) y Resumen por unidad (ingresos vs gastos, utilidad, km/l). Las
// unidades son las de Logística; quien opera logística captura, el chofer
// asignado a la unidad también registra sus viajes y cargas.

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const dinero = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

interface Obra {
  id: string;
  nombre: string;
  empresa_id: string;
}
interface Comun {
  unidades: Unidad[];
  unidadPorId: Map<string, Unidad>;
  opera: boolean;
  miId: string | null;
  nombreEmpresa: Map<string, string>;
  onOk: (m: string) => void;
  onError: (e: Error) => void;
}

/** El chofer asignado a la unidad captura sus propios viajes y cargas. */
function puedeCapturar(c: Pick<Comun, "opera" | "miId" | "unidades">): boolean {
  return c.opera || (!!c.miId && c.unidades.some((u) => u.chofer_id === c.miId));
}
function unidadesCapturables(c: Pick<Comun, "opera" | "miId" | "unidades">): Unidad[] {
  return c.unidades.filter((u) => u.estado !== "baja" && (c.opera || u.chofer_id === c.miId));
}

// ── Viajes ───────────────────────────────────────────────────────────────

export function Viajes({ unidades, unidadPorId, viajes, obras, opera, miId, nombreEmpresa, onOk, onError }: Comun & { viajes: Viaje[]; obras: Obra[] }) {
  const [mes, setMes] = useState(hoyMx().slice(0, 7));
  const [unidadFiltro, setUnidadFiltro] = useState("");
  const [texto, setTexto] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [editando, setEditando] = useState<Viaje | null>(null);
  const capturables = unidadesCapturables({ opera, miId, unidades });
  const vacio = {
    unidad_id: capturables.length === 1 ? capturables[0].id : "",
    fecha: hoyMx(),
    hora_salida: "",
    hora_regreso: "",
    chofer_nombre: "",
    tipo: "flete",
    cliente: "",
    proyecto_id: "",
    origen: "",
    destino: "",
    material: "",
    cantidad: "",
    unidad_medida: "m3",
    viajes: "1",
    precio: "",
    importe: "",
    cobrado: false,
    forma_cobro: "",
    referencia_cobro: "",
    km_inicial: "",
    km_final: "",
    manifiesto_folio: "",
    manifiesto_registro: "",
    residuo_tipo: "",
    ticket: "",
    estado: "terminado",
    notas: "",
  };
  const [form, setForm] = useState(vacio);
  const periodo = periodoMes(mes);
  const lista = useMemo(
    () => filtrarViajes(viajes.filter((v) => enPeriodo(v.fecha, periodo) && (!unidadFiltro || v.unidad_id === unidadFiltro)), texto).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.folio ?? "").localeCompare(a.folio ?? "")),
    [viajes, periodo, unidadFiltro, texto],
  );
  const nombreUnidad = (id: string) => unidadPorId.get(id)?.nombre ?? "—";
  const importeCalc = importeViaje(form);

  const abrir = (v?: Viaje) => {
    setEditando(v ?? null);
    setForm(
      v
        ? {
            unidad_id: v.unidad_id,
            fecha: v.fecha,
            hora_salida: v.hora_salida?.slice(0, 5) ?? "",
            hora_regreso: v.hora_regreso?.slice(0, 5) ?? "",
            chofer_nombre: v.chofer_nombre ?? "",
            tipo: v.tipo,
            cliente: v.cliente ?? "",
            proyecto_id: v.proyecto_id ?? "",
            origen: v.origen ?? "",
            destino: v.destino ?? "",
            material: v.material ?? "",
            cantidad: v.cantidad == null ? "" : String(v.cantidad),
            unidad_medida: v.unidad_medida,
            viajes: String(v.viajes),
            precio: String(v.precio),
            importe: String(v.importe),
            cobrado: v.cobrado,
            forma_cobro: v.forma_cobro ?? "",
            referencia_cobro: v.referencia_cobro ?? "",
            km_inicial: v.km_inicial == null ? "" : String(v.km_inicial),
            km_final: v.km_final == null ? "" : String(v.km_final),
            manifiesto_folio: v.manifiesto_folio ?? "",
            manifiesto_registro: v.manifiesto_registro ?? "",
            residuo_tipo: v.residuo_tipo ?? "",
            ticket: v.ticket ?? "",
            estado: v.estado,
            notas: v.notas ?? "",
          }
        : vacio,
    );
    setMostrar(true);
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const falta = revisarViaje(form);
      if (falta) throw new Error(falta);
      const u = unidadPorId.get(form.unidad_id);
      const fila = {
        unidad_id: form.unidad_id,
        empresa_id: u?.empresa_id,
        fecha: form.fecha,
        hora_salida: form.hora_salida || null,
        hora_regreso: form.hora_regreso || null,
        chofer_nombre: form.chofer_nombre.trim() || null,
        tipo: form.tipo,
        cliente: form.cliente.trim() || null,
        proyecto_id: form.proyecto_id || null,
        origen: form.origen.trim() || null,
        destino: form.destino.trim() || null,
        material: form.material.trim() || null,
        cantidad: form.cantidad.trim() === "" ? null : Number(form.cantidad),
        unidad_medida: form.unidad_medida,
        viajes: form.viajes.trim() === "" ? 1 : Number(form.viajes),
        precio: form.precio.trim() === "" ? 0 : Number(form.precio),
        importe: importeCalc,
        cobrado: form.cobrado,
        forma_cobro: form.forma_cobro.trim() || null,
        referencia_cobro: form.referencia_cobro.trim() || null,
        km_inicial: form.km_inicial.trim() === "" ? null : Number(form.km_inicial),
        km_final: form.km_final.trim() === "" ? null : Number(form.km_final),
        manifiesto_folio: form.manifiesto_folio.trim() || null,
        manifiesto_registro: form.manifiesto_registro.trim() || null,
        residuo_tipo: form.residuo_tipo.trim() || null,
        ticket: form.ticket.trim() || null,
        estado: form.estado,
        notas: form.notas.trim() || null,
      };
      const { error } = editando ? await supabase.from("logistica_viajes").update(fila).eq("id", editando.id) : await supabase.from("logistica_viajes").insert({ ...fila, created_by: miId });
      if (error) throw error;
    },
    onSuccess: () => {
      onOk(editando ? "Viaje actualizado." : "Viaje registrado con su folio.");
      setMostrar(false);
      setEditando(null);
    },
    onError,
  });
  const cambiar = useMutation({
    mutationFn: async ({ v, cambios }: { v: Viaje; cambios: Partial<Viaje> }) => {
      const { error } = await supabase.from("logistica_viajes").update(cambios).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => onOk("Viaje actualizado."),
    onError,
  });

  async function imprimirManifiesto(seleccion: Viaje[]) {
    if (seleccion.length === 0) return;
    const ventana = abrirVentanaImpresion();
    try {
      const u = unidadPorId.get(seleccion[0].unidad_id);
      const m = await membreteEmpresa(seleccion[0].empresa_id);
      const html = htmlManifiestoResiduos(
        { razon_social: m.razon_social ?? nombreEmpresa.get(seleccion[0].empresa_id) ?? "", rfc: m.rfc, domicilio: m.domicilio, registro: seleccion.find((v) => v.manifiesto_registro)?.manifiesto_registro ?? null },
        { nombre: seleccion[0].chofer_nombre ?? u?.chofer_nombre ?? "", placas: u?.placas ?? null, unidad: u?.nombre ?? null },
        seleccion,
      );
      if (!abrirParaImprimir(html, ventana)) onError(new Error("El navegador bloqueó la ventana. Permite ventanas emergentes."));
    } catch (e) {
      cerrarVentanaImpresion(ventana);
      onError(e as Error);
    }
  }
  async function imprimirBitacora() {
    if (!unidadFiltro) {
      onError(new Error("Elige una unidad para imprimir su bitácora."));
      return;
    }
    const ventana = abrirVentanaImpresion();
    try {
      const u = unidadPorId.get(unidadFiltro);
      const { data: gs } = await supabase.from("logistica_gastos").select("*").eq("unidad_id", unidadFiltro).gte("fecha", periodo.desde).lte("fecha", periodo.hasta).order("fecha");
      const html = htmlBitacoraViajes(nombreEmpresa.get(u?.empresa_id ?? "") ?? "", { nombre: u?.nombre ?? "", placas: u?.placas ?? null, unidad: [u?.marca, u?.modelo].filter(Boolean).join(" ") || null }, periodo, lista, (gs ?? []) as Gasto[]);
      if (!abrirParaImprimir(html, ventana)) onError(new Error("El navegador bloqueó la ventana. Permite ventanas emergentes."));
    } catch (e) {
      cerrarVentanaImpresion(ventana);
      onError(e as Error);
    }
  }

  const obrasDe = (unidadId: string) => {
    const emp = unidadPorId.get(unidadId)?.empresa_id;
    return obras.filter((o) => !emp || o.empresa_id === emp);
  };
  const totales = useMemo(() => totalesResumen(resumenPorUnidad(lista, [])), [lista]);
  const residuos = lista.filter((v) => v.tipo === "residuos" && v.estado !== "cancelado");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={`${campo} w-auto`} />
        <select value={unidadFiltro} onChange={(e) => setUnidadFiltro(e.target.value)} className={`${campo} w-auto`}>
          <option value="">Todas las unidades</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre} · {u.placas ?? "sin placas"}
            </option>
          ))}
        </select>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar folio, cliente, obra, material, chofer, ticket" className={`${campo} max-w-xs`} />
        <span className="text-xs text-slate-500">
          {lista.length} viaje(s) · {dinero(totales.ingresos)} · por cobrar {dinero(totales.por_cobrar)}
          {totales.km ? ` · ${totales.km.toLocaleString("es-MX")} km` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => descargarCsv(`viajes-volteo-${mes}.csv`, csvViajes(lista, nombreUnidad))} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700">
            Excel
          </button>
          <button type="button" onClick={imprimirBitacora} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700" title="Viajes, gastos y resumen de la unidad elegida en el mes">
            Bitácora de la unidad
          </button>
          {residuos.length > 0 && (
            <button type="button" onClick={() => imprimirManifiesto(residuos)} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700" title="Manifiesto de residuos de manejo especial con los viajes de residuos del mes">
              Manifiesto de residuos ({residuos.length})
            </button>
          )}
          {puedeCapturar({ opera, miId, unidades }) && (
            <button onClick={() => (mostrar && !editando ? setMostrar(false) : abrir())} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
              {mostrar && !editando ? "Cancelar" : "+ Registrar viaje"}
            </button>
          )}
        </div>
      </div>

      {mostrar && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mb-4 rounded border border-slate-300 bg-white p-4 shadow-sm"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{editando ? `${editando.folio} · editar viaje` : "Nuevo viaje"}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className={etiqueta}>Unidad *</label>
              <select value={form.unidad_id} onChange={(e) => setForm({ ...form, unidad_id: e.target.value, chofer_nombre: form.chofer_nombre || unidadPorId.get(e.target.value)?.chofer_nombre || "" })} className={campo} required disabled={!!editando}>
                <option value="">Elige…</option>
                {capturables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} · {u.placas ?? "sin placas"} · {nombreEmpresa.get(u.empresa_id) ?? ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Fecha *</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={campo} required />
            </div>
            <div>
              <label className={etiqueta}>Salida</label>
              <input type="time" value={form.hora_salida} onChange={(e) => setForm({ ...form, hora_salida: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Regreso</label>
              <input type="time" value={form.hora_regreso} onChange={(e) => setForm({ ...form, hora_regreso: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Tipo *</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={campo}>
                {TIPOS_VIAJE.map((t) => (
                  <option key={t.clave} value={t.clave}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Chofer / operador</label>
              <input value={form.chofer_nombre} onChange={(e) => setForm({ ...form, chofer_nombre: e.target.value })} className={campo} placeholder="Si no se escribe, el de la unidad" />
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Cliente</label>
              <input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} className={campo} placeholder="A quién se le cobra (empresa del grupo o externo)" />
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Obra</label>
              <select value={form.proyecto_id} onChange={(e) => setForm({ ...form, proyecto_id: e.target.value })} className={campo}>
                <option value="">Sin obra</option>
                {obrasDe(form.unidad_id).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Origen</label>
              <input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} className={campo} placeholder="Banco, bodega, obra…" />
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Destino</label>
              <input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className={campo} placeholder="Obra, tiradero, cliente…" />
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Material</label>
              <input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} className={campo} list="materiales-volteo" placeholder="Arena, grava, escombro…" />
              <datalist id="materiales-volteo">
                {MATERIALES_SUGERIDOS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={etiqueta}>Cantidad</label>
              <input type="number" step="0.001" min="0" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Medida</label>
              <select value={form.unidad_medida} onChange={(e) => setForm({ ...form, unidad_medida: e.target.value })} className={campo}>
                {UNIDADES_MEDIDA.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Viajes</label>
              <input type="number" step="1" min="1" value={form.viajes} onChange={(e) => setForm({ ...form, viajes: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Precio s/IVA</label>
              <input type="number" step="0.01" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value, importe: "" })} className={campo} placeholder={form.unidad_medida === "viaje" ? "por viaje" : `por ${form.unidad_medida}`} />
            </div>
            <div>
              <label className={etiqueta}>Importe</label>
              <input type="number" step="0.01" min="0" value={form.importe} onChange={(e) => setForm({ ...form, importe: e.target.value })} className={campo} placeholder={importeCalc ? importeCalc.toFixed(2) : "cantidad × precio"} />
            </div>
            <div>
              <label className={etiqueta}>Cobro</label>
              <label className="flex items-center gap-1 pt-2 text-sm">
                <input type="checkbox" checked={form.cobrado} onChange={(e) => setForm({ ...form, cobrado: e.target.checked })} /> cobrado
              </label>
            </div>
            <div>
              <label className={etiqueta}>Km inicial</label>
              <input type="number" step="0.1" min="0" value={form.km_inicial} onChange={(e) => setForm({ ...form, km_inicial: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Km final</label>
              <input type="number" step="0.1" min="0" value={form.km_final} onChange={(e) => setForm({ ...form, km_final: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Ticket / vale</label>
              <input value={form.ticket} onChange={(e) => setForm({ ...form, ticket: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Estado</label>
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className={campo}>
                {(Object.keys(ETIQUETA_ESTADO_VIAJE) as (keyof typeof ETIQUETA_ESTADO_VIAJE)[]).map((k) => (
                  <option key={k} value={k}>
                    {ETIQUETA_ESTADO_VIAJE[k]}
                  </option>
                ))}
              </select>
            </div>
            {form.tipo === "residuos" && (
              <>
                <div className="lg:col-span-2">
                  <label className={etiqueta}>Folio del manifiesto *</label>
                  <input value={form.manifiesto_folio} onChange={(e) => setForm({ ...form, manifiesto_folio: e.target.value })} className={campo} />
                </div>
                <div className="lg:col-span-2">
                  <label className={etiqueta}>Registro del generador</label>
                  <input value={form.manifiesto_registro} onChange={(e) => setForm({ ...form, manifiesto_registro: e.target.value })} className={campo} placeholder="Ej. TRCMD-217-2304/2025" />
                </div>
                <div className="lg:col-span-2">
                  <label className={etiqueta}>Tipo de residuo</label>
                  <input value={form.residuo_tipo} onChange={(e) => setForm({ ...form, residuo_tipo: e.target.value })} className={campo} placeholder="Escombro, chatarra, madera…" />
                </div>
              </>
            )}
            {form.cobrado && (
              <>
                <div className="lg:col-span-2">
                  <label className={etiqueta}>Forma de cobro</label>
                  <input value={form.forma_cobro} onChange={(e) => setForm({ ...form, forma_cobro: e.target.value })} className={campo} placeholder="Efectivo, transferencia, OV…" />
                </div>
                <div className="lg:col-span-2">
                  <label className={etiqueta}>Referencia del cobro</label>
                  <input value={form.referencia_cobro} onChange={(e) => setForm({ ...form, referencia_cobro: e.target.value })} className={campo} />
                </div>
              </>
            )}
            <div className="sm:col-span-3 lg:col-span-6">
              <label className={etiqueta}>Notas</label>
              <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className={campo} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Registrar viaje"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMostrar(false);
                setEditando(null);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Cerrar
            </button>
            <span className="text-xs text-slate-500">Importe: {dinero(importeCalc)} s/IVA</span>
          </div>
        </form>
      )}

      {lista.length === 0 ? (
        <p className="text-sm text-slate-500">Sin viajes en {mes}{unidadFiltro ? " para esa unidad" : ""}. Da de alta las unidades en la pestaña Unidades (tipo "Volteo") y registra aquí cada viaje.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-2">Folio</th>
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">Unidad / chofer</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Cliente / obra</th>
                <th className="px-2 py-2">Trayecto</th>
                <th className="px-2 py-2">Material</th>
                <th className="px-2 py-2 text-right">Cantidad</th>
                <th className="px-2 py-2 text-right">Importe</th>
                <th className="px-2 py-2">Cobro</th>
                <th className="px-2 py-2 text-right">Km</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => {
                const u = unidadPorId.get(v.unidad_id);
                const puedo = opera || (!!miId && u?.chofer_id === miId);
                return (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono">{v.folio}</td>
                    <td className="px-2 py-2">
                      {v.fecha}
                      {v.hora_salida ? <div className="text-[11px] text-slate-500">{v.hora_salida.slice(0, 5)}{v.hora_regreso ? `–${v.hora_regreso.slice(0, 5)}` : ""}</div> : null}
                    </td>
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-900">{u?.nombre ?? "—"}</div>
                      <div className="text-[11px] text-slate-500">{v.chofer_nombre ?? u?.chofer_nombre ?? ""}</div>
                    </td>
                    <td className="px-2 py-2">{TIPOS_VIAJE.find((t) => t.clave === v.tipo)?.etiqueta ?? v.tipo}</td>
                    <td className="px-2 py-2">
                      {v.cliente ?? "—"}
                      {v.proyecto_id && <div className="text-[11px] text-slate-500">{obras.find((o) => o.id === v.proyecto_id)?.nombre ?? ""}</div>}
                    </td>
                    <td className="px-2 py-2">{[v.origen, v.destino].filter(Boolean).join(" → ") || "—"}</td>
                    <td className="px-2 py-2">
                      {v.material ?? "—"}
                      {v.manifiesto_folio && <div className="text-[11px] text-slate-500">manifiesto {v.manifiesto_folio}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{v.cantidad != null ? `${Number(v.cantidad).toLocaleString("es-MX")} ${v.unidad_medida}` : `${v.viajes} viaje(s)`}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dinero(v.importe)}</td>
                    <td className="px-2 py-2">
                      {v.cobrado ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800" title={[v.cobrado_en, v.forma_cobro, v.referencia_cobro].filter(Boolean).join(" · ")}>
                          cobrado
                        </span>
                      ) : puedo && v.estado !== "cancelado" ? (
                        <button type="button" onClick={() => cambiar.mutate({ v, cambios: { cobrado: true } })} className="text-amber-700 underline">
                          por cobrar
                        </button>
                      ) : (
                        <span className="text-amber-700">por cobrar</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{kmViaje(v) ?? "—"}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 ${CLASE_ESTADO_VIAJE[v.estado]}`}>{ETIQUETA_ESTADO_VIAJE[v.estado]}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {puedo && (
                        <>
                          <button onClick={() => abrir(v)} className="mr-2 text-slate-600 underline">
                            editar
                          </button>
                          {v.tipo === "residuos" && (
                            <button onClick={() => imprimirManifiesto([v])} className="mr-2 text-slate-600 underline">
                              manifiesto
                            </button>
                          )}
                          {v.estado !== "cancelado" && (
                            <button onClick={() => window.confirm(`¿Cancelar el viaje ${v.folio}?`) && cambiar.mutate({ v, cambios: { estado: "cancelado" } })} className="text-red-700 underline">
                              cancelar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Gastos por unidad ────────────────────────────────────────────────────

export function Gastos({ unidades, unidadPorId, gastos, viajes, opera, miId, nombreEmpresa, onOk, onError }: Comun & { gastos: Gasto[]; viajes: Viaje[] }) {
  const [mes, setMes] = useState(hoyMx().slice(0, 7));
  const [unidadFiltro, setUnidadFiltro] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [editando, setEditando] = useState<Gasto | null>(null);
  const capturables = unidadesCapturables({ opera, miId, unidades });
  const vacio = { unidad_id: capturables.length === 1 ? capturables[0].id : "", viaje_id: "", fecha: hoyMx(), tipo: "diesel", descripcion: "", litros: "", monto: "", proveedor: "", referencia: "", km: "" };
  const [form, setForm] = useState(vacio);
  const periodo = periodoMes(mes);
  const lista = useMemo(() => gastos.filter((g) => enPeriodo(g.fecha, periodo) && (!unidadFiltro || g.unidad_id === unidadFiltro)).sort((a, b) => b.fecha.localeCompare(a.fecha)), [gastos, periodo, unidadFiltro]);
  const total = lista.reduce((s, g) => s + Number(g.monto), 0);
  const litros = lista.reduce((s, g) => s + Number(g.litros ?? 0), 0);
  const nombreUnidad = (id: string) => unidadPorId.get(id)?.nombre ?? "—";

  const abrir = (g?: Gasto) => {
    setEditando(g ?? null);
    setForm(g ? { unidad_id: g.unidad_id, viaje_id: g.viaje_id ?? "", fecha: g.fecha, tipo: g.tipo, descripcion: g.descripcion ?? "", litros: g.litros == null ? "" : String(g.litros), monto: String(g.monto), proveedor: g.proveedor ?? "", referencia: g.referencia ?? "", km: g.km == null ? "" : String(g.km) } : vacio);
    setMostrar(true);
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const falta = revisarGasto(form);
      if (falta) throw new Error(falta);
      const fila = {
        unidad_id: form.unidad_id,
        empresa_id: unidadPorId.get(form.unidad_id)?.empresa_id,
        viaje_id: form.viaje_id || null,
        fecha: form.fecha,
        tipo: form.tipo,
        descripcion: form.descripcion.trim() || null,
        litros: form.litros.trim() === "" ? null : Number(form.litros),
        monto: Number(form.monto),
        proveedor: form.proveedor.trim() || null,
        referencia: form.referencia.trim() || null,
        km: form.km.trim() === "" ? null : Number(form.km),
      };
      const { error } = editando ? await supabase.from("logistica_gastos").update(fila).eq("id", editando.id) : await supabase.from("logistica_gastos").insert({ ...fila, created_by: miId });
      if (error) throw error;
    },
    onSuccess: () => {
      onOk(editando ? "Gasto actualizado." : "Gasto registrado.");
      setMostrar(false);
      setEditando(null);
    },
    onError,
  });
  const viajesDe = (unidadId: string) => viajes.filter((v) => v.unidad_id === unidadId && v.estado !== "cancelado").slice(0, 60);
  const esComb = TIPOS_GASTO.find((t) => t.clave === form.tipo)?.combustible;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={`${campo} w-auto`} />
        <select value={unidadFiltro} onChange={(e) => setUnidadFiltro(e.target.value)} className={`${campo} w-auto`}>
          <option value="">Todas las unidades</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre} · {u.placas ?? "sin placas"}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {lista.length} gasto(s) · {dinero(total)}
          {litros ? ` · ${litros.toLocaleString("es-MX")} L` : ""}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => descargarCsv(`gastos-unidades-${mes}.csv`, csvGastos(lista, nombreUnidad))} className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700">
            Excel
          </button>
          {puedeCapturar({ opera, miId, unidades }) && (
            <button onClick={() => (mostrar && !editando ? setMostrar(false) : abrir())} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
              {mostrar && !editando ? "Cancelar" : "+ Registrar gasto"}
            </button>
          )}
        </div>
      </div>
      {mostrar && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mb-4 max-w-4xl rounded border border-slate-300 bg-white p-4 shadow-sm"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{editando ? `${editando.folio} · editar gasto` : "Nuevo gasto"}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <label className={etiqueta}>Unidad *</label>
              <select value={form.unidad_id} onChange={(e) => setForm({ ...form, unidad_id: e.target.value, viaje_id: "" })} className={campo} required disabled={!!editando}>
                <option value="">Elige…</option>
                {capturables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} · {u.placas ?? "sin placas"} · {nombreEmpresa.get(u.empresa_id) ?? ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Fecha *</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={campo} required />
            </div>
            <div>
              <label className={etiqueta}>Tipo *</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={campo}>
                {TIPOS_GASTO.map((t) => (
                  <option key={t.clave} value={t.clave}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Monto *</label>
              <input type="number" step="0.01" min="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} className={campo} required />
            </div>
            {esComb && (
              <>
                <div>
                  <label className={etiqueta}>Litros</label>
                  <input type="number" step="0.01" min="0" value={form.litros} onChange={(e) => setForm({ ...form, litros: e.target.value })} className={campo} />
                </div>
                <div>
                  <label className={etiqueta}>Odómetro (km)</label>
                  <input type="number" step="0.1" min="0" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} className={campo} />
                </div>
              </>
            )}
            <div className="lg:col-span-2">
              <label className={etiqueta}>Descripción</label>
              <input value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Proveedor</label>
              <input value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} className={campo} placeholder="Gasolinera, taller…" />
            </div>
            <div>
              <label className={etiqueta}>Ticket / factura</label>
              <input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} className={campo} />
            </div>
            <div className="lg:col-span-2">
              <label className={etiqueta}>Viaje (opcional)</label>
              <select value={form.viaje_id} onChange={(e) => setForm({ ...form, viaje_id: e.target.value })} className={campo}>
                <option value="">Sin viaje en particular</option>
                {viajesDe(form.unidad_id).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.folio} · {v.fecha} · {v.cliente ?? v.destino ?? ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Registrar gasto"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMostrar(false);
                setEditando(null);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Cerrar
            </button>
          </div>
        </form>
      )}
      {lista.length === 0 ? (
        <p className="text-sm text-slate-500">Sin gastos en {mes}.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-2">Folio</th>
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">Unidad</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Descripción</th>
                <th className="px-2 py-2">Proveedor</th>
                <th className="px-2 py-2 text-right">Litros</th>
                <th className="px-2 py-2 text-right">Km</th>
                <th className="px-2 py-2 text-right">Monto</th>
                <th className="px-2 py-2">Capturó</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((g) => {
                const u = unidadPorId.get(g.unidad_id);
                const puedo = opera || (!!miId && u?.chofer_id === miId);
                return (
                  <tr key={g.id} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono">{g.folio}</td>
                    <td className="px-2 py-2">{g.fecha}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{u?.nombre ?? "—"}</td>
                    <td className="px-2 py-2">{TIPOS_GASTO.find((t) => t.clave === g.tipo)?.etiqueta ?? g.tipo}</td>
                    <td className="px-2 py-2">
                      {g.descripcion ?? "—"}
                      {g.viaje_id && <div className="text-[11px] text-slate-500">viaje {viajes.find((v) => v.id === g.viaje_id)?.folio ?? ""}</div>}
                    </td>
                    <td className="px-2 py-2">
                      {g.proveedor ?? "—"}
                      {g.referencia && <div className="text-[11px] text-slate-500">{g.referencia}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.litros ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.km ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dinero(g.monto)}</td>
                    <td className="px-2 py-2 text-slate-500">{g.created_by_nombre ?? ""}</td>
                    <td className="px-2 py-2 text-right">
                      {puedo && (
                        <button onClick={() => abrir(g)} className="text-slate-600 underline">
                          editar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Resumen por unidad ───────────────────────────────────────────────────

export function ResumenUnidades({ unidades, unidadPorId, viajes, gastos, nombreEmpresa }: { unidades: Unidad[]; unidadPorId: Map<string, Unidad>; viajes: Viaje[]; gastos: Gasto[]; nombreEmpresa: Map<string, string> }) {
  const [mes, setMes] = useState(hoyMx().slice(0, 7));
  const [todo, setTodo] = useState(false);
  const periodo = periodoMes(mes);
  const vs = useMemo(() => (todo ? viajes : viajes.filter((v) => enPeriodo(v.fecha, periodo))), [viajes, periodo, todo]);
  const gs = useMemo(() => (todo ? gastos : gastos.filter((g) => enPeriodo(g.fecha, periodo))), [gastos, periodo, todo]);
  const filas = useMemo(
    () =>
      resumenPorUnidad(
        vs,
        gs,
        unidades.filter((u) => u.estado !== "baja").map((u) => u.id),
      ),
    [vs, gs, unidades],
  );
  const totales = totalesResumen(filas);
  const meses = useMemo(() => porMes(viajes, gastos).slice(-12), [viajes, gastos]);
  const maximo = Math.max(1, ...meses.map((m) => Math.max(m.ingresos, m.gastos)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={`${campo} w-auto`} disabled={todo} />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> todo el histórico
        </label>
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Viajes", String(totales.viajes)],
          ["Ingresos", dinero(totales.ingresos)],
          ["Por cobrar", dinero(totales.por_cobrar)],
          ["Gastos", dinero(totales.gastos)],
          ["Utilidad", `${dinero(totales.utilidad)}${totales.margen_pct != null ? ` · ${totales.margen_pct} %` : ""}`],
          ["Km / litros", `${totales.km.toLocaleString("es-MX")} km · ${totales.litros.toLocaleString("es-MX")} L`],
        ].map(([t, v]) => (
          <div key={t} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-xs uppercase text-slate-500">{t}</div>
            <div className={`text-lg font-semibold ${t === "Utilidad" ? (totales.utilidad < 0 ? "text-red-700" : "text-emerald-700") : "text-slate-900"}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-2">Unidad</th>
              <th className="px-2 py-2 text-right">Viajes</th>
              <th className="px-2 py-2 text-right">m³ / ton</th>
              <th className="px-2 py-2 text-right">Ingresos</th>
              <th className="px-2 py-2 text-right">Por cobrar</th>
              <th className="px-2 py-2 text-right">Combustible</th>
              <th className="px-2 py-2 text-right">Otros gastos</th>
              <th className="px-2 py-2 text-right">Utilidad</th>
              <th className="px-2 py-2 text-right">Km</th>
              <th className="px-2 py-2 text-right">Km/L</th>
              <th className="px-2 py-2 text-right">$/km</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => {
              const u = unidadPorId.get(r.unidad_id);
              return (
                <tr key={r.unidad_id} className="border-t border-slate-100">
                  <td className="px-2 py-2">
                    <div className="font-medium text-slate-900">{u?.nombre ?? r.unidad_id}</div>
                    <div className="text-[11px] text-slate-500">
                      {u?.placas ?? ""} · {nombreEmpresa.get(u?.empresa_id ?? "") ?? ""} · {u?.chofer_nombre ?? "sin chofer"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.viajes}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {r.cantidad_m3 ? `${r.cantidad_m3.toLocaleString("es-MX")} m³` : ""}
                    {r.cantidad_ton ? ` ${r.cantidad_ton.toLocaleString("es-MX")} t` : ""}
                    {!r.cantidad_m3 && !r.cantidad_ton ? "—" : ""}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{dinero(r.ingresos)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.por_cobrar > 0 ? "text-amber-700" : ""}`}>{dinero(r.por_cobrar)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{dinero(r.combustible)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{dinero(r.gastos - r.combustible)}</td>
                  <td className={`px-2 py-2 text-right font-medium tabular-nums ${r.utilidad < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {dinero(r.utilidad)}
                    {r.margen_pct != null && <span className="ml-1 text-[11px] text-slate-500">{r.margen_pct} %</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.km ? r.km.toLocaleString("es-MX") : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.km_por_litro ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.costo_por_km != null ? dinero(r.costo_por_km) : "—"}</td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={11} className="px-2 py-6 text-center text-slate-500">
                  Sin unidades activas. Dalas de alta en la pestaña Unidades.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {meses.length > 0 && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs font-medium uppercase text-slate-500">Ingresos y gastos por mes (todas las unidades, últimos 12 meses)</div>
          <div className="flex items-end gap-2 overflow-x-auto">
            {meses.map((m) => (
              <div key={m.mes} className="flex w-16 shrink-0 flex-col items-center gap-1 text-[10px] text-slate-600">
                <div className="flex h-24 items-end gap-0.5">
                  <div className="w-5 rounded-t bg-emerald-500" style={{ height: `${Math.max(2, (m.ingresos / maximo) * 96)}px` }} title={`Ingresos ${dinero(m.ingresos)}`} />
                  <div className="w-5 rounded-t bg-rose-400" style={{ height: `${Math.max(2, (m.gastos / maximo) * 96)}px` }} title={`Gastos ${dinero(m.gastos)}`} />
                </div>
                <div>{m.mes.slice(2).replace("-", "/")}</div>
                <div className={m.utilidad < 0 ? "text-red-700" : "text-emerald-700"}>{dinero(m.utilidad)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
