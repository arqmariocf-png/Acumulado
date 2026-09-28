import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { filtrarYOrdenar, semaforoCredito, totalesCxp, type ColorCredito, type FilaCxp, type OrdenCxp } from "../../lib/cuentasPorPagar";

const PUNTO: Record<ColorCredito, string> = {
  gris: "bg-slate-300",
  verde: "bg-emerald-500",
  ambar: "bg-amber-400",
  rojo: "bg-red-500",
};

interface DetalleCxp {
  ordenes: { id: string; id_orden: string | null; tipo: string | null; fecha: string | null; proyecto: string | null; total: number; empresa_id: string; proveedor: string }[];
  facturas: { id: string; folio: string | null; fecha: string | null; total: number; empresa_id: string; contraparte: string; rfc: string | null; complemento: boolean }[];
  pagos: { id: string; fecha: string | null; monto: number; empresa_id: string; nombre: string | null; referencia: string | null; factura: string | null }[];
}

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });
}

function fecha(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

/** Cuentas por pagar por proveedor: el "primer candado" de dirección al
 * revisar OC. Comprometido (OC) → facturado (CFDI) → pagado (complementos +
 * cargos bancarios con el mismo nombre) → por pagar, contra la línea de
 * crédito que se captura aquí mismo. */
export function CuentasPorPagar() {
  const { perfil } = useAuth();
  const puedeEditar = !!perfil && ["admin", "corporativo", "direccion"].includes(perfil.rol);
  const { data: empresas } = useEmpresas();
  const [texto, setTexto] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [orden, setOrden] = useState<OrdenCxp>("por_pagar");
  const [soloConSaldo, setSoloConSaldo] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);

  const { data: filas, isLoading, error } = useQuery({
    queryKey: ["cxp-proveedores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cxp_proveedores").select("*");
      if (error) throw error;
      return (data ?? []) as FilaCxp[];
    },
  });

  const lista = useMemo(() => filtrarYOrdenar(filas ?? [], texto, empresaId, orden, soloConSaldo), [filas, texto, empresaId, orden, soloConSaldo]);
  const totales = useMemo(() => totalesCxp(lista), [lista]);
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo || e.nombre])), [empresas]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cuentas por pagar por proveedor</h1>
          <p className="text-sm text-slate-500">Lo comprometido en OC, lo facturado, lo pagado que se detecta y la línea de crédito disponible de cada proveedor.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/finanzas/saldos" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100">
            Saldos por empresa
          </Link>
          <Link to="/finanzas/pagos" className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white">
            Programación de pagos
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tarjeta etiqueta="Comprometido en OC" valor={totales.comprometido} />
        <Tarjeta etiqueta="Facturado" valor={totales.facturado} />
        <Tarjeta etiqueta="Pagado detectado" valor={totales.pagado} />
        <Tarjeta etiqueta="Por pagar" valor={totales.por_pagar} destacado />
        <Tarjeta etiqueta="Proveedores en rojo" valor={totales.rojos} entero nota={`${totales.con_linea} con línea capturada`} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor…" className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Todas las empresas</option>
          {empresas?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenCxp)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="por_pagar">Más por pagar primero</option>
          <option value="disponible">Menos crédito disponible primero</option>
          <option value="comprometido">Más comprometido primero</option>
          <option value="proveedor">Por nombre</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={soloConSaldo} onChange={(e) => setSoloConSaldo(e.target.checked)} />
          Solo con saldo pendiente
        </label>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando proveedores…</p>}

      {filas && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2 text-right">Comprometido (OC)</th>
                <th className="px-3 py-2 text-right">Facturado</th>
                <th className="px-3 py-2 text-right">Pagado detectado</th>
                <th className="px-3 py-2 text-right">Por pagar</th>
                <th className="px-3 py-2 text-right">Sin facturar</th>
                <th className="px-3 py-2 text-right">Línea de crédito</th>
                <th className="px-3 py-2 text-right">Disponible</th>
                <th className="px-3 py-2">Semáforo</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const s = semaforoCredito(f.por_pagar, f.linea_credito);
                const estaAbierto = abierto === f.clave;
                return (
                  <FilaProveedor key={f.clave} fila={f} semaforo={s} abierto={estaAbierto} onToggle={() => setAbierto(estaAbierto ? null : f.clave)} puedeEditar={puedeEditar} nombreEmpresa={nombreEmpresa} />
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    Sin proveedores para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-100 text-sm font-semibold">
              <tr>
                <td className="px-3 py-2">{lista.length} proveedores</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(totales.comprometido)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(totales.facturado)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(totales.pagado)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(totales.por_pagar)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{moneda(totales.sin_facturar)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Por pagar = facturado − pagado. "Pagado detectado" solo cuenta complementos de pago y cargos bancarios cuyo nombre coincide con el del proveedor; si el banco lo registra con otro nombre, el saldo sale alto. Sin facturar = OC comprometidas que aún no tienen CFDI. La línea de crédito la captura dirección
        {puedeEditar ? " dando clic en la fila" : ""}.
      </p>
    </div>
  );
}

function Tarjeta({ etiqueta, valor, destacado = false, entero = false, nota }: { etiqueta: string; valor: number; destacado?: boolean; entero?: boolean; nota?: string }) {
  return (
    <div className={`rounded border px-3 py-2 ${destacado ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
      <p className={`text-[11px] uppercase ${destacado ? "text-slate-300" : "text-slate-500"}`}>{etiqueta}</p>
      <p className="text-lg font-semibold tabular-nums">{entero ? valor : moneda(valor)}</p>
      {nota && <p className={`text-[11px] ${destacado ? "text-slate-300" : "text-slate-400"}`}>{nota}</p>}
    </div>
  );
}

function FilaProveedor({
  fila: f,
  semaforo: s,
  abierto,
  onToggle,
  puedeEditar,
  nombreEmpresa,
}: {
  fila: FilaCxp;
  semaforo: ReturnType<typeof semaforoCredito>;
  abierto: boolean;
  onToggle: () => void;
  puedeEditar: boolean;
  nombreEmpresa: Map<string, string>;
}) {
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer border-t border-slate-200 hover:bg-slate-50 ${abierto ? "bg-slate-50" : ""}`}>
        <td className="px-3 py-2">
          <div className="font-medium text-slate-900">{f.proveedor}</div>
          <div className="text-[11px] text-slate-400">
            {f.n_oc} OC · {f.n_facturas} facturas
            {(f.empresas ?? []).length > 0 && <> · {(f.empresas ?? []).map((e) => nombreEmpresa.get(e) ?? "?").join(", ")}</>}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{moneda(f.comprometido)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{moneda(f.facturado)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{Number(f.pagado) ? moneda(f.pagado) : "—"}</td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{moneda(f.por_pagar)}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{Number(f.sin_facturar) ? moneda(f.sin_facturar) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{f.linea_credito != null ? moneda(f.linea_credito) : <span className="text-slate-400">—</span>}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${f.disponible != null && Number(f.disponible) < 0 ? "text-red-700" : ""}`}>{f.disponible != null ? moneda(f.disponible) : <span className="text-slate-400">—</span>}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${PUNTO[s.color]}`} />
            {s.etiqueta}
            {s.pctUsado != null && <span className="text-slate-400">({s.pctUsado} %)</span>}
          </span>
        </td>
      </tr>
      {abierto && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={9} className="px-3 py-3">
            <DetalleProveedor fila={f} puedeEditar={puedeEditar} nombreEmpresa={nombreEmpresa} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleProveedor({ fila: f, puedeEditar, nombreEmpresa }: { fila: FilaCxp; puedeEditar: boolean; nombreEmpresa: Map<string, string> }) {
  const queryClient = useQueryClient();
  const [linea, setLinea] = useState(f.linea_credito != null ? String(f.linea_credito) : "");
  const [dias, setDias] = useState(f.dias_credito != null ? String(f.dias_credito) : "");
  const [notas, setNotas] = useState(f.notas ?? "");
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: detalle, isLoading } = useQuery({
    queryKey: ["cxp-detalle", f.clave],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_cxp_proveedor_detalle", { p_clave: f.clave });
      if (error) throw error;
      return data as DetalleCxp;
    },
  });

  const guardar = useMutation({
    mutationFn: async () => {
      const lineaNum = linea.trim() === "" ? 0 : Number(linea.replace(/[^0-9.-]/g, ""));
      const diasNum = dias.trim() === "" ? 0 : Number(dias);
      if (!Number.isFinite(lineaNum) || lineaNum < 0) throw new Error("La línea de crédito debe ser un número mayor o igual a cero.");
      if (!Number.isInteger(diasNum) || diasNum < 0) throw new Error("Los días de crédito deben ser un entero.");
      const { error } = await supabase.from("proveedores_credito").upsert({ clave: f.clave, nombre: f.proveedor, linea_credito: lineaNum, dias_credito: diasNum, notas: notas.trim() || null }, { onConflict: "clave" });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Guardado.");
      queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="rounded border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Línea de crédito con {f.proveedor}</h3>
        {puedeEditar ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAviso(null);
              guardar.mutate();
            }}
            className="space-y-2 text-sm"
          >
            <label className="block">
              <span className="text-xs text-slate-500">Monto de la línea (MXN)</span>
              <input value={linea} onChange={(e) => setLinea(e.target.value)} inputMode="decimal" placeholder="0" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Días de crédito</span>
              <input value={dias} onChange={(e) => setDias(e.target.value)} inputMode="numeric" placeholder="0" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Notas (condiciones, contacto, vencimiento)</span>
              <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5" />
            </label>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {guardar.isPending ? "Guardando…" : "Guardar línea"}
              </button>
              {aviso && <span className={`text-xs ${aviso === "Guardado." ? "text-emerald-700" : "text-red-700"}`}>{aviso}</span>}
            </div>
          </form>
        ) : (
          <dl className="text-sm text-slate-700">
            <dt className="text-xs text-slate-500">Línea</dt>
            <dd>{f.linea_credito != null ? moneda(f.linea_credito) : "sin capturar"}</dd>
            <dt className="mt-1 text-xs text-slate-500">Días</dt>
            <dd>{f.dias_credito ?? "—"}</dd>
            {f.notas && (
              <>
                <dt className="mt-1 text-xs text-slate-500">Notas</dt>
                <dd>{f.notas}</dd>
              </>
            )}
          </dl>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
          <div>
            <dt>Última OC</dt>
            <dd className="text-slate-800">{fecha(f.ultima_oc)}</dd>
          </div>
          <div>
            <dt>Última factura</dt>
            <dd className="text-slate-800">{fecha(f.ultima_factura)}</dd>
          </div>
          <div>
            <dt>Último pago</dt>
            <dd className="text-slate-800">{fecha(f.ultimo_pago)}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3">
        {isLoading && <p className="text-xs text-slate-400">Cargando detalle…</p>}
        {detalle && (
          <>
            <Lista titulo={`Órdenes de compra (${detalle.ordenes.length})`}>
              {detalle.ordenes.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 whitespace-nowrap">{fecha(o.fecha)}</td>
                  <td className="px-2 py-1">
                    {o.tipo ?? "OC"} {o.id_orden ?? ""}
                    <span className="text-slate-400"> · {nombreEmpresa.get(o.empresa_id) ?? ""}</span>
                  </td>
                  <td className="px-2 py-1 text-slate-500">{o.proyecto ?? "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{moneda(o.total)}</td>
                </tr>
              ))}
            </Lista>
            <Lista titulo={`Facturas recibidas (${detalle.facturas.filter((c) => !c.complemento).length}) y complementos (${detalle.facturas.filter((c) => c.complemento).length})`}>
              {detalle.facturas.map((c) => (
                <tr key={c.id} className={`border-t border-slate-100 ${c.complemento ? "text-emerald-700" : ""}`}>
                  <td className="px-2 py-1 whitespace-nowrap">{fecha(c.fecha)}</td>
                  <td className="px-2 py-1">
                    {c.complemento ? "Complemento" : "Factura"} {c.folio ?? ""}
                    <span className="text-slate-400"> · {nombreEmpresa.get(c.empresa_id) ?? ""}</span>
                  </td>
                  <td className="px-2 py-1 text-slate-500">{c.rfc ?? "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{moneda(c.total)}</td>
                </tr>
              ))}
            </Lista>
            <Lista titulo={`Cargos bancarios con este nombre (${detalle.pagos.length})`}>
              {detalle.pagos.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 whitespace-nowrap">{fecha(p.fecha)}</td>
                  <td className="px-2 py-1">
                    {p.nombre ?? "—"}
                    <span className="text-slate-400"> · {nombreEmpresa.get(p.empresa_id) ?? ""}</span>
                  </td>
                  <td className="max-w-xs truncate px-2 py-1 text-slate-500" title={p.factura ?? undefined}>
                    {p.referencia ?? p.factura ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{moneda(p.monto)}</td>
                </tr>
              ))}
            </Lista>
          </>
        )}
      </div>
    </div>
  );
}

function Lista({ titulo, children }: { titulo: string; children: ReactNode[] }) {
  return (
    <div className="rounded border border-slate-200 bg-white">
      <h4 className="border-b border-slate-100 px-2 py-1.5 text-xs font-semibold uppercase text-slate-500">{titulo}</h4>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-xs">
          <tbody>
            {children}
            {children.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-center text-slate-400">Nada registrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
