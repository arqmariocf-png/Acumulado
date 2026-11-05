import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { logoDeEmpresa } from "../../lib/logoEmpresaCargar";
import { CALIBRES_CELOSIA, CALIBRES_VARILLA, FICHA_BASE, aceroVigueta, cuerpoFicha, estilosFicha, htmlFichaVigueta, pesoVigueta, type FichaVigueta } from "../../lib/fichaVigueta";
import {
  CLARO_MAXIMO_POR_PERALTE,
  PARAMETROS_BASE,
  PRECIOS_BASE,
  cotizar,
  despiezar,
  htmlCotizacionBalken,
  type ParametrosDespiece,
  type PreciosCotizacion,
  type Tablero,
} from "../../lib/despieceBalken";

const CLAVE_LOCAL = "balken-despiece-config-v1";
const CLAVE_FICHA = "balken-ficha-vigueta-v1";

const campo = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const etiqueta = "mb-0.5 block text-[11px] font-medium text-slate-600";

function money(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}
function num(n: number, d = 2): string {
  return n.toLocaleString("es-MX", { maximumFractionDigits: d });
}

function leerConfig(): { parametros: ParametrosDespiece; precios: PreciosCotizacion } | null {
  try {
    const crudo = localStorage.getItem(CLAVE_LOCAL);
    if (!crudo) return null;
    const v = JSON.parse(crudo);
    return { parametros: { ...PARAMETROS_BASE, ...v.parametros }, precios: { ...PRECIOS_BASE, ...v.precios } };
  } catch {
    return null;
  }
}

const TABLERO_NUEVO = (): Tablero => ({ nombre: "", claro: 0, ancho: 0, cantidad: 1 });

function leerFicha(): FichaVigueta {
  try {
    const crudo = localStorage.getItem(CLAVE_FICHA);
    return crudo ? { ...FICHA_BASE, ...JSON.parse(crudo) } : FICHA_BASE;
  } catch {
    return FICHA_BASE;
  }
}

/** Despiece de losa de vigueta y bovedilla + cotización rápida (Balken).
 * Los parámetros y precios se recuerdan en este navegador. */
export function DespieceBalken({ empresaNombre, empresaCodigo }: { empresaNombre: string; empresaCodigo?: string }) {
  const { perfil } = useAuth();
  // Ficha técnica de la vigueta (5-nov-2026): se edita aquí, se imprime sola o
  // se anexa a la cotización.
  const [ficha, setFicha] = useState<FichaVigueta>(leerFicha);
  const [fichaAbierta, setFichaAbierta] = useState(false);
  const [anexarFicha, setAnexarFicha] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_FICHA, JSON.stringify(ficha));
    } catch {
      /* sin almacenamiento local */
    }
  }, [ficha]);
  const acero = useMemo(() => aceroVigueta(ficha), [ficha]);
  const peso = useMemo(() => pesoVigueta(ficha), [ficha]);
  function setF<K extends keyof FichaVigueta>(k: K, v: FichaVigueta[K]) {
    setFicha((prev) => ({ ...prev, [k]: v }));
  }
  const guardado = useMemo(leerConfig, []);
  const [parametros, setParametros] = useState<ParametrosDespiece>(guardado?.parametros ?? PARAMETROS_BASE);
  const [precios, setPrecios] = useState<PreciosCotizacion>(guardado?.precios ?? PRECIOS_BASE);
  const [tableros, setTableros] = useState<Tablero[]>([{ nombre: "Tablero 1", claro: 4, ancho: 3.5, cantidad: 1 }]);
  const [cliente, setCliente] = useState("");
  const [obra, setObra] = useState("");
  const [vigencia, setVigencia] = useState("15 días");
  const [notas, setNotas] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify({ parametros, precios }));
    } catch {
      /* sin almacenamiento local: se pierde al recargar, nada más */
    }
  }, [parametros, precios]);

  const despiece = useMemo(() => despiezar(tableros, parametros), [tableros, parametros]);
  const cotizacion = useMemo(() => cotizar(despiece, parametros, precios), [despiece, parametros, precios]);
  const claroMaximo = CLARO_MAXIMO_POR_PERALTE[parametros.peralteVigueta];

  function setTablero(i: number, cambio: Partial<Tablero>) {
    setTableros((prev) => prev.map((t, j) => (j === i ? { ...t, ...cambio } : t)));
  }
  function setParam<K extends keyof ParametrosDespiece>(k: K, v: ParametrosDespiece[K]) {
    setParametros((prev) => ({ ...prev, [k]: v }));
  }
  function setPrecio<K extends keyof PreciosCotizacion>(k: K, v: number) {
    setPrecios((prev) => ({ ...prev, [k]: Number.isFinite(v) ? v : 0 }));
  }

  async function imprimir() {
    setAviso(null);
    // La pestaña se abre en el clic (móvil) y se llena cuando llega el logo.
    const ventana = window.open("", "_blank");
    const fecha = new Date().toLocaleDateString("es-MX");
    const logoUrl = anexarFicha ? await logoDeEmpresa(empresaCodigo ?? "VBB") : null;
    const html = htmlCotizacionBalken(
      { empresa: empresaNombre, cliente, obra, fecha, vigencia, elaboro: perfil?.nombre ?? null, notas },
      parametros,
      despiece,
      cotizacion,
      anexarFicha ? { html: cuerpoFicha(ficha, { empresa: empresaNombre, empresaCodigo, logoUrl, fecha, elaboro: perfil?.nombre ?? null }), estilos: estilosFicha() } : undefined,
    );
    if (!abrirParaImprimir(html, ventana)) setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.");
  }
  async function imprimirFicha() {
    setAviso(null);
    const ventana = window.open("", "_blank");
    const logoUrl = await logoDeEmpresa(empresaCodigo ?? "VBB");
    const html = htmlFichaVigueta(ficha, { empresa: empresaNombre, empresaCodigo, logoUrl, fecha: new Date().toLocaleDateString("es-MX"), elaboro: perfil?.nombre ?? null });
    if (!abrirParaImprimir(html, ventana)) setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Captura los tableros de la losa (claro en el sentido de las viguetas y ancho donde se reparten). El despiece y la cotización se
        recalculan al momento; los parámetros y precios se guardan en este navegador.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Tableros */}
        <div className="lg:col-span-2 rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Tableros</h3>
            <button onClick={() => setTableros((p) => [...p, { ...TABLERO_NUEVO(), nombre: `Tablero ${p.length + 1}` }])} className="text-xs text-slate-700 underline">
              + Agregar tablero
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-1 py-1">Nombre</th>
                  <th className="px-1 py-1">Claro (m)</th>
                  <th className="px-1 py-1">Ancho (m)</th>
                  <th className="px-1 py-1">Cant.</th>
                  <th className="px-1 py-1 text-right">Área</th>
                  <th className="px-1 py-1 text-right">Viguetas</th>
                  <th className="px-1 py-1 text-right">Bovedillas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tableros.map((t, i) => {
                  const d = despiece.tableros.find((x) => x.tablero === t);
                  return (
                    <tr key={i} className="border-t border-slate-100 align-middle">
                      <td className="px-1 py-1">
                        <input value={t.nombre} onChange={(e) => setTablero(i, { nombre: e.target.value })} className={campo} />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" min="0" value={t.claro || ""} onChange={(e) => setTablero(i, { claro: Number(e.target.value) })} className={`${campo} w-20 ${d?.excedeClaro ? "border-amber-500 bg-amber-50" : ""}`} />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="0.01" min="0" value={t.ancho || ""} onChange={(e) => setTablero(i, { ancho: Number(e.target.value) })} className={`${campo} w-20`} />
                      </td>
                      <td className="px-1 py-1">
                        <input type="number" step="1" min="1" value={t.cantidad} onChange={(e) => setTablero(i, { cantidad: Number(e.target.value) })} className={`${campo} w-16`} />
                      </td>
                      <td className="px-1 py-1 text-right text-slate-600">{d ? num(d.area) : "—"}</td>
                      <td className="whitespace-nowrap px-1 py-1 text-right text-slate-600">{d ? `${d.viguetas} × ${num(d.longitudVigueta)} m` : "—"}</td>
                      <td className="px-1 py-1 text-right text-slate-600">{d ? d.bovedillas : "—"}</td>
                      <td className="px-1 py-1">
                        <button onClick={() => setTableros((p) => p.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {despiece.tableros.some((d) => d.excedeClaro) && (
            <p className="mt-2 text-xs text-amber-700">
              Hay tableros con claro mayor a {num(claroMaximo)} m, el máximo orientativo para vigueta de {parametros.peralteVigueta} cm. Considera un
              peralte mayor o confirma con cálculo estructural.
            </p>
          )}
        </div>

        {/* Parámetros */}
        <div className="rounded border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Sistema</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={etiqueta}>Peralte de vigueta</label>
              <select value={parametros.peralteVigueta} onChange={(e) => setParam("peralteVigueta", Number(e.target.value))} className={campo}>
                {[12, 15, 20].map((p) => (
                  <option key={p} value={p}>
                    {p} cm (claro ≤ {num(CLARO_MAXIMO_POR_PERALTE[p])} m)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Separación ejes (m)</label>
              <input type="number" step="0.01" value={parametros.separacionEjes} onChange={(e) => setParam("separacionEjes", Number(e.target.value) || 0.7)} className={campo} />
            </div>
            <div className="col-span-2">
              <label className={etiqueta}>Bovedilla</label>
              <input value={parametros.bovedilla} onChange={(e) => setParam("bovedilla", e.target.value)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Largo bovedilla (m)</label>
              <input type="number" step="0.01" value={parametros.largoBovedilla} onChange={(e) => setParam("largoBovedilla", Number(e.target.value) || 0.25)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Desperdicio bovedilla %</label>
              <input type="number" step="1" value={Math.round(parametros.desperdicioBovedilla * 100)} onChange={(e) => setParam("desperdicioBovedilla", (Number(e.target.value) || 0) / 100)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Apoyo por lado (cm)</label>
              <input type="number" step="1" value={Math.round(parametros.apoyo * 100)} onChange={(e) => setParam("apoyo", (Number(e.target.value) || 0) / 100)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Redondeo vigueta (cm)</label>
              <input type="number" step="1" value={Math.round(parametros.redondeoVigueta * 100)} onChange={(e) => setParam("redondeoVigueta", (Number(e.target.value) || 0) / 100)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Capa compresión (cm)</label>
              <input type="number" step="1" value={Math.round(parametros.espesorCapa * 100)} onChange={(e) => setParam("espesorCapa", (Number(e.target.value) || 0) / 100)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Nervios (m³/m²)</label>
              <input type="number" step="0.005" value={parametros.concretoNervios} onChange={(e) => setParam("concretoNervios", Number(e.target.value) || 0)} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Traslape malla</label>
              <input type="number" step="0.01" value={parametros.traslapeMalla} onChange={(e) => setParam("traslapeMalla", Number(e.target.value) || 1)} className={campo} />
            </div>
          </div>
          <button onClick={() => setParametros(PARAMETROS_BASE)} className="mt-2 text-xs text-slate-500 underline">
            Restablecer valores base
          </button>
        </div>
      </div>

      {/* Despiece */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded border border-slate-200 bg-white p-3 lg:col-span-1">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Despiece</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Área de losa</dt><dd>{num(despiece.area)} m²</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Viguetas</dt><dd>{despiece.viguetas} pzas · {num(despiece.metrosVigueta)} m</dd></div>
            {despiece.viguetasPorLongitud.map((v) => (
              <div key={v.longitud} className="flex justify-between pl-3 text-xs text-slate-600">
                <dt>{num(v.longitud)} m</dt>
                <dd>{v.piezas} pzas</dd>
              </div>
            ))}
            <div className="flex justify-between"><dt className="text-slate-500">Bovedillas</dt><dd>{despiece.bovedillas} pzas</dd></div>
            <div className="flex justify-between pl-3 text-xs text-slate-600"><dt>Con desperdicio</dt><dd>{despiece.bovedillasConDesperdicio} pzas</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Concreto (capa + nervios)</dt><dd>{num(despiece.concretoM3, 3)} m³</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Malla con traslape</dt><dd>{num(despiece.mallaM2)} m²</dd></div>
          </dl>
        </div>

        {/* Precios */}
        <div className="rounded border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Precios</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={etiqueta}>Vigueta $/m</label><input type="number" step="0.01" value={precios.viguetaPorMetro || ""} onChange={(e) => setPrecio("viguetaPorMetro", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>Bovedilla $/pza</label><input type="number" step="0.01" value={precios.bovedillaPorPieza || ""} onChange={(e) => setPrecio("bovedillaPorPieza", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>Concreto $/m³ (opc.)</label><input type="number" step="0.01" value={precios.concretoPorM3 || ""} onChange={(e) => setPrecio("concretoPorM3", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>Malla $/m² (opc.)</label><input type="number" step="0.01" value={precios.mallaPorM2 || ""} onChange={(e) => setPrecio("mallaPorM2", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>Montaje $/m² (opc.)</label><input type="number" step="0.01" value={precios.manoObraPorM2 || ""} onChange={(e) => setPrecio("manoObraPorM2", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>Flete $ (opc.)</label><input type="number" step="0.01" value={precios.flete || ""} onChange={(e) => setPrecio("flete", Number(e.target.value))} className={campo} /></div>
            <div><label className={etiqueta}>IVA %</label><input type="number" step="1" value={Math.round(precios.iva * 100)} onChange={(e) => setPrecio("iva", (Number(e.target.value) || 0) / 100)} className={campo} /></div>
          </div>
        </div>

        {/* Cotización */}
        <div className="rounded border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Cotización</h3>
          <table className="w-full text-xs">
            <tbody>
              {cotizacion.lineas.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{l.concepto}</td>
                  <td className="py-1 text-right text-slate-500">{num(l.cantidad, 3)} {l.unidad}</td>
                  <td className="py-1 text-right">{money(l.importe)}</td>
                </tr>
              ))}
              {cotizacion.lineas.length === 0 && (
                <tr>
                  <td className="py-2 text-slate-400" colSpan={3}>
                    Captura precios para ver la cotización.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="text-sm">
              <tr className="border-t border-slate-200"><td colSpan={2} className="py-1 text-slate-500">Subtotal</td><td className="py-1 text-right">{money(cotizacion.subtotal)}</td></tr>
              <tr><td colSpan={2} className="py-1 text-slate-500">IVA</td><td className="py-1 text-right">{money(cotizacion.iva)}</td></tr>
              <tr className="font-semibold"><td colSpan={2} className="py-1">Total</td><td className="py-1 text-right">{money(cotizacion.total)}</td></tr>
              <tr><td colSpan={2} className="py-1 text-slate-500">Precio por m² (sin IVA)</td><td className="py-1 text-right">{money(cotizacion.precioPorM2)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Datos de la cotización e impresión */}
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div><label className={etiqueta}>Cliente</label><input value={cliente} onChange={(e) => setCliente(e.target.value)} className={campo} /></div>
          <div><label className={etiqueta}>Obra</label><input value={obra} onChange={(e) => setObra(e.target.value)} className={campo} /></div>
          <div><label className={etiqueta}>Vigencia</label><input value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={campo} /></div>
          <div className="flex items-end">
            <button onClick={imprimir} disabled={despiece.area === 0} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              Imprimir cotización
            </button>
          </div>
          <div className="sm:col-span-4"><label className={etiqueta}>Notas</label><textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={campo} /></div>
          <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-4">
            <input type="checkbox" checked={anexarFicha} onChange={(e) => setAnexarFicha(e.target.checked)} /> Anexar la ficha técnica de la vigueta a la cotización (segunda hoja)
          </label>
        </div>
        {aviso && <p className="mt-2 text-sm text-red-600">{aviso}</p>}
      </div>

      {/* Ficha técnica de la vigueta */}
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Ficha técnica de la vigueta</h3>
            <p className="text-xs text-slate-500">
              {ficha.nombre} · {acero.descripcion} · acero {num(acero.totalKgM)} kg/m · peso {num(peso.totalKgM, 1)} kg/m · hasta {num(ficha.largoMaximo)} m
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFichaAbierta((v) => !v)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800">{fichaAbierta ? "Cerrar" : "Editar datos"}</button>
            <button onClick={imprimirFicha} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Imprimir ficha técnica</button>
          </div>
        </div>
        {fichaAbierta && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2"><label className={etiqueta}>Nombre comercial</label><input value={ficha.nombre} onChange={(e) => setF("nombre", e.target.value)} className={campo} /></div>
            <div><label className={etiqueta}>Peralte (cm)</label><input type="number" step="1" value={ficha.peralte} onChange={(e) => setF("peralte", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Patín inferior (cm)</label><input type="number" step="0.5" value={ficha.anchoPatin} onChange={(e) => setF("anchoPatin", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Alma (cm)</label><input type="number" step="0.5" value={ficha.anchoAlma} onChange={(e) => setF("anchoAlma", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Sección concreto (cm²)</label><input type="number" step="1" value={ficha.seccionCm2} onChange={(e) => setF("seccionCm2", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Largo máximo (m)</label><input type="number" step="0.5" value={ficha.largoMaximo} onChange={(e) => setF("largoMaximo", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Cortes en múltiplos de (cm)</label><input type="number" step="1" value={ficha.multiploCorte} onChange={(e) => setF("multiploCorte", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>f'c concreto (kg/cm²)</label><input type="number" step="50" value={ficha.fcConcreto} onChange={(e) => setF("fcConcreto", Number(e.target.value) || 0)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-3"><label className={etiqueta}>Concreto (descripción)</label><input value={ficha.concretoTexto} onChange={(e) => setF("concretoTexto", e.target.value)} className={campo} /></div>
            <div><label className={etiqueta}>Varillas inferiores</label><input type="number" step="1" min="0" value={ficha.varillasInferiores} onChange={(e) => setF("varillasInferiores", Math.max(0, Math.round(Number(e.target.value) || 0)))} className={campo} /></div>
            <div><label className={etiqueta}>Calibre inferior</label><select value={ficha.calibreInferior} onChange={(e) => setF("calibreInferior", e.target.value)} className={campo}>{CALIBRES_VARILLA.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={etiqueta}>Varillas superiores</label><input type="number" step="1" min="0" value={ficha.varillasSuperiores} onChange={(e) => setF("varillasSuperiores", Math.max(0, Math.round(Number(e.target.value) || 0)))} className={campo} /></div>
            <div><label className={etiqueta}>Calibre superior</label><select value={ficha.calibreSuperior} onChange={(e) => setF("calibreSuperior", e.target.value)} className={campo}>{CALIBRES_VARILLA.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={etiqueta}>Celosía (alambrón)</label><select value={ficha.calibreCelosia} onChange={(e) => setF("calibreCelosia", e.target.value)} className={campo}>{CALIBRES_CELOSIA.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={etiqueta}>Celosía: m de alambrón por m</label><input type="number" step="0.1" value={ficha.celosiaMetrosPorMetro} onChange={(e) => setF("celosiaMetrosPorMetro", Number(e.target.value) || 0)} className={campo} /></div>
            <div className="col-span-2"><label className={etiqueta}>Grado de la varilla</label><input value={ficha.gradoVarilla} onChange={(e) => setF("gradoVarilla", e.target.value)} className={campo} /></div>
            <div><label className={etiqueta}>Separación ejes (m)</label><input type="number" step="0.01" value={ficha.separacionEjes} onChange={(e) => setF("separacionEjes", Number(e.target.value) || 0)} className={campo} /></div>
            <div className="col-span-2"><label className={etiqueta}>Bovedilla</label><input value={ficha.bovedilla} onChange={(e) => setF("bovedilla", e.target.value)} className={campo} /></div>
            <div><label className={etiqueta}>Capa de compresión (cm)</label><input type="number" step="1" value={ficha.capaCompresion} onChange={(e) => setF("capaCompresion", Number(e.target.value) || 0)} className={campo} /></div>
            <div className="col-span-2"><label className={etiqueta}>Malla de la capa</label><input value={ficha.mallaCapa} onChange={(e) => setF("mallaCapa", e.target.value)} className={campo} /></div>
            <div><label className={etiqueta}>Claro recomendado (m)</label><input type="number" step="0.1" value={ficha.claroMaximo} onChange={(e) => setF("claroMaximo", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Carga de servicio (kg/m²)</label><input type="number" step="10" value={ficha.cargaServicio || ""} placeholder="por confirmar" onChange={(e) => setF("cargaServicio", Number(e.target.value) || 0)} className={campo} /></div>
            <div><label className={etiqueta}>Apoyo mínimo (cm)</label><input type="number" step="1" value={ficha.apoyoMinimo} onChange={(e) => setF("apoyoMinimo", Number(e.target.value) || 0)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-6"><label className={etiqueta}>Apuntalamiento</label><input value={ficha.apuntalamiento} onChange={(e) => setF("apuntalamiento", e.target.value)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-3"><label className={etiqueta}>Usos</label><input value={ficha.usos} onChange={(e) => setF("usos", e.target.value)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-3"><label className={etiqueta}>Manejo y estiba</label><input value={ficha.manejo} onChange={(e) => setF("manejo", e.target.value)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-3"><label className={etiqueta}>Normas de referencia</label><input value={ficha.normas} onChange={(e) => setF("normas", e.target.value)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-3"><label className={etiqueta}>Notas</label><input value={ficha.notas} onChange={(e) => setF("notas", e.target.value)} className={campo} /></div>
            <div className="col-span-2 sm:col-span-4 lg:col-span-6 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>Acero calculado: {num(acero.varillasKgM)} kg/m de varilla + {num(acero.celosiaKgM)} kg/m de celosía = <b>{num(acero.totalKgM)} kg/m</b>. Peso ≈ {num(peso.totalKgM, 1)} kg/m.</span>
              <button onClick={() => setFicha(FICHA_BASE)} className="text-slate-500 underline">Restablecer ficha base</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
