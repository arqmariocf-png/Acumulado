import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { AgregarRenglon } from "./AgregarRenglon";
import { CircuitoFirmas } from "./CircuitoFirmas";
import {
  COLOR_ESTADO,
  ETIQUETA_ESTADO,
  ORDEN_GRUPOS,
  TITULO_GRUPO,
  cifra,
  descargarPdf,
  dinero,
  fechaCorta,
  porcentaje,
} from "./comun";
import type { PuAprobacion, PuCosteo, PuEstado, PuFactor, PuRenglon } from "../../types/database";

function useDetalle(id: string) {
  return useQuery({
    queryKey: ["pu-detalle", id],
    queryFn: async () => {
      const [cab, renglones, bitacora] = await Promise.all([
        supabase.from("v_pu_analisis_costeo").select("*").eq("analisis_id", id).maybeSingle(),
        supabase.from("v_pu_analisis_detalle").select("*").eq("analisis_id", id).order("orden"),
        supabase.from("pu_aprobaciones").select("*").eq("analisis_id", id).order("created_at", { ascending: false }),
      ]);
      if (cab.error) throw cab.error;
      return {
        pu: cab.data as PuCosteo | null,
        renglones: (renglones.data ?? []) as PuRenglon[],
        bitacora: (bitacora.data ?? []) as PuAprobacion[],
      };
    },
  });
}

function useFactores(empresaId: string | undefined) {
  return useQuery({
    queryKey: ["pu-factores", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pu_factores")
        .select("*")
        .eq("empresa_id", empresaId!)
        .eq("activo", true)
        .order("vigente_desde", { ascending: false });
      if (error) throw error;
      return data as PuFactor[];
    },
  });
}

export function Detalle() {
  const { id = "" } = useParams();
  const { perfil } = useAuth();
  const queryClient = useQueryClient();

  const [filaEnPrecio, setFilaEnPrecio] = useState<string | null>(null);
  const [filaEnCantidad, setFilaEnCantidad] = useState<string | null>(null);
  const [filaEnDescripcion, setFilaEnDescripcion] = useState<string | null>(null);
  const [editandoCabecera, setEditandoCabecera] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [comentario, setComentario] = useState("");
  const [errorPdf, setErrorPdf] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  const { data, isLoading, error } = useDetalle(id);
  const { data: factores } = useFactores(data?.pu?.empresa_id);

  const rol = perfil?.rol;
  const esAdmin = rol === "admin";

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["pu-detalle", id] });

  const mover = useMutation({
    mutationFn: async (destino: PuEstado) => {
      const { error: err } = await supabase
        .from("pu_analisis")
        .update({ estado: destino, comentario_revision: comentario.trim() || null })
        .eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setComentario("");
      invalidar();
      queryClient.invalidateQueries({ queryKey: ["pu-analisis"] });
      queryClient.invalidateQueries({ queryKey: ["pu-publicados"] });
    },
  });

  const borrarRenglon = useMutation({
    mutationFn: async (itemId: string) => {
      const { error: err } = await supabase.from("pu_analisis_items").delete().eq("id", itemId);
      if (err) throw err;
    },
    onSuccess: invalidar,
  });

  const guardarPrecio = useMutation({
    mutationFn: async ({ itemId, costo, proveedor }: { itemId: string; costo: number; proveedor: string }) => {
      const { error: err } = await supabase
        .from("pu_analisis_items")
        .update({ costo_congelado: costo, proveedor: proveedor.trim() || null })
        .eq("id", itemId);
      if (err) throw err;
    },
    onSuccess: () => {
      setFilaEnPrecio(null);
      invalidar();
    },
  });

  // Corregir la cantidad/rendimiento de una partida ya capturada, sin tener
  // que quitarla y volverla a agregar. RLS (auth_edita_borrador_pu) ya deja
  // hacerlo a quien participa en la tarjeta mientras esté en borrador.
  const guardarCantidad = useMutation({
    mutationFn: async ({ itemId, cantidad, rendimiento }: { itemId: string; cantidad: number; rendimiento?: number }) => {
      const cambios: Record<string, number> = { cantidad };
      if (rendimiento !== undefined) cambios.rendimiento = rendimiento;
      const { error: err } = await supabase.from("pu_analisis_items").update(cambios).eq("id", itemId);
      if (err) throw err;
    },
    onSuccess: () => {
      setFilaEnCantidad(null);
      invalidar();
    },
  });

  // Descripción propia del renglón (medidas, lado, acabado) sin tocar el
  // insumo del catálogo, que comparten todas las empresas. Vacío = catálogo.
  const guardarDescripcion = useMutation({
    mutationFn: async ({ itemId, descripcion }: { itemId: string; descripcion: string }) => {
      const { error: err } = await supabase
        .from("pu_analisis_items")
        .update({ descripcion_manual: descripcion.trim() || null })
        .eq("id", itemId);
      if (err) throw err;
    },
    onSuccess: () => {
      setFilaEnDescripcion(null);
      invalidar();
    },
  });

  const guardarCabecera = useMutation({
    mutationFn: async ({ concepto, unidad }: { concepto: string; unidad: string }) => {
      const { error: err } = await supabase.from("pu_analisis").update({ concepto: concepto.trim(), unidad: unidad.trim() }).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setEditandoCabecera(false);
      invalidar();
      queryClient.invalidateQueries({ queryKey: ["pu-analisis"] });
    },
  });

  const asignarFactor = useMutation({
    mutationFn: async (factorId: string) => {
      const { error: err } = await supabase
        .from("pu_analisis")
        .update({ factor_id: factorId || null })
        .eq("id", id);
      if (err) throw err;
    },
    onSuccess: invalidar,
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">Error: {(error as Error).message}</p>;
  if (!data?.pu)
    return <p className="py-12 text-center text-sm text-slate-400">Este análisis no existe o no tienes acceso.</p>;

  const { pu, renglones, bitacora } = data;

  // La tarjeta se va congelando conforme avanza: quién puede tocar qué lo
  // decide la base (RLS + triggers). Aquí sólo se decide qué botones mostrar,
  // para no ofrecer acciones que van a rebotar.
  const puedeEditar =
    pu.estado === "borrador" &&
    (esAdmin || rol === "responsable" || rol === "direccion" || rol === "corporativo" || rol === "empresa");
  const puedePrecio = (pu.estado === "en_revision_material" && (rol === "almacen" || esAdmin)) || puedeEditar;
  const puedeFactor = esAdmin && (pu.estado === "autorizado" || pu.estado === "material_confirmado");

  const acciones: { destino: PuEstado; etiqueta: string; tono: string }[] = [];
  if (pu.estado === "borrador" && puedeEditar)
    acciones.push({ destino: "en_revision_material", etiqueta: "Enviar a revisión de material", tono: "bg-slate-900" });
  if (pu.estado === "en_revision_material" && (rol === "almacen" || esAdmin))
    acciones.push({ destino: "material_confirmado", etiqueta: "Confirmar material", tono: "bg-emerald-700" });
  if (pu.estado === "material_confirmado" && (rol === "direccion" || esAdmin))
    acciones.push({ destino: "autorizado", etiqueta: "Autorizar", tono: "bg-emerald-700" });
  if (pu.estado === "autorizado" && esAdmin)
    acciones.push({ destino: "publicado", etiqueta: "Publicar", tono: "bg-emerald-700" });

  const puedeRechazar = !["borrador", "publicado", "obsoleto"].includes(pu.estado);

  return (
    <div className="grid gap-4">
      <Link to="/precios" className="text-sm text-slate-500 hover:text-slate-700">
        ‹ Volver a análisis
      </Link>

      <section className="rounded border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">
          {pu.codigo} · {pu.empresa_codigo}
        </p>
        {editandoCabecera ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              guardarCabecera.mutate({ concepto: String(f.get("concepto") ?? ""), unidad: String(f.get("unidad") ?? "") });
            }}
            className="mt-2 grid gap-2"
          >
            <textarea name="concepto" required defaultValue={pu.concepto} rows={4} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-600">
                Unidad{" "}
                <input name="unidad" required defaultValue={pu.unidad} className="ml-1 w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
              </label>
              <button disabled={guardarCabecera.isPending} className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
                {guardarCabecera.isPending ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" onClick={() => setEditandoCabecera(false)} className="text-sm text-slate-500 underline">
                Cancelar
              </button>
            </div>
            {guardarCabecera.error && <p className="text-sm text-red-600">{(guardarCabecera.error as Error).message}</p>}
          </form>
        ) : (
          <>
            <h2 className="mt-1 font-medium text-slate-900">{pu.concepto}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {pu.proyecto_nombre ?? "Biblioteca"} · unidad {pu.unidad}
              {pu.creado_por_nombre && ` · elaboró ${pu.creado_por_nombre}`}
              {puedeEditar && (
                <>
                  {" · "}
                  <button onClick={() => setEditandoCabecera(true)} className="text-slate-600 underline">
                    editar concepto
                  </button>
                </>
              )}
            </p>
          </>
        )}
        <span className={`mt-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[pu.estado]}`}>
          {ETIQUETA_ESTADO[pu.estado]}
        </span>
        {pu.insumos_sin_precio > 0 && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {pu.insumos_sin_precio} insumo(s) sin costo en catálogo: se están contando en cero.
          </p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Concepto</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Costo unitario</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ORDEN_GRUPOS.map((tipo) => {
                const filas = renglones.filter((r) => r.tipo === tipo);
                if (filas.length === 0) return null;
                // 'herramienta' y 'equipo' comparten encabezado: sólo se pinta
                // en el primero de los dos que traiga renglones.
                const yaPintado = tipo === "equipo" && renglones.some((r) => r.tipo === "herramienta");
                const subtotal = filas.reduce((s, r) => s + Number(r.importe), 0);

                return (
                  <Fragment key={tipo}>
                    {!yaPintado && (
                      <tr key={`g-${tipo}`} className="bg-slate-50">
                        <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {TITULO_GRUPO[tipo]}
                        </td>
                      </tr>
                    )}
                    {filas.map((r) => (
                      <tr key={r.item_id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          {filaEnDescripcion === r.item_id ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                guardarDescripcion.mutate({ itemId: r.item_id, descripcion: String(f.get("descripcion") ?? "") });
                              }}
                              className="grid gap-1"
                            >
                              <textarea
                                name="descripcion"
                                defaultValue={r.descripcion ?? ""}
                                rows={3}
                                autoFocus
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <button className="rounded bg-slate-900 px-3 py-1 font-medium text-white" disabled={guardarDescripcion.isPending}>
                                  Guardar
                                </button>
                                {r.descripcion_personalizada && (
                                  <button
                                    type="button"
                                    onClick={() => guardarDescripcion.mutate({ itemId: r.item_id, descripcion: "" })}
                                    className="text-slate-600 underline"
                                  >
                                    volver a la del catálogo
                                  </button>
                                )}
                                <button type="button" onClick={() => setFilaEnDescripcion(null)} className="text-slate-600 underline">
                                  cancelar
                                </button>
                                {guardarDescripcion.isError && <span className="text-red-600">{(guardarDescripcion.error as Error).message}</span>}
                              </div>
                              {r.descripcion_personalizada && r.descripcion_catalogo && (
                                <p className="text-xs text-slate-400">Catálogo: {r.descripcion_catalogo}</p>
                              )}
                            </form>
                          ) : (
                            <p className="text-slate-900">
                              {r.descripcion}
                              {puedeEditar && r.tipo !== "auxiliar" && (
                                <button
                                  type="button"
                                  onClick={() => setFilaEnDescripcion(r.item_id)}
                                  className="ml-2 text-xs text-slate-500 underline"
                                  title="Editar la descripción de este renglón (medidas, lado, acabado) sin cambiar el catálogo"
                                >
                                  editar
                                </button>
                              )}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            {r.codigo}
                            {r.descripcion_personalizada && " · descripción propia de este análisis"}
                            {r.proveedor && ` · ${r.proveedor}`}
                          </p>
                          {r.sin_precio && <p className="text-xs text-amber-700">Sin precio en catálogo</p>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.base_calculo === "pct_mano_obra" ? porcentaje(r.aportacion) : cifra(r.aportacion)}
                          <span className="block text-xs text-slate-400">{r.unidad}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{dinero(r.costo_unitario)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.costo_cerrado ? "font-semibold" : ""}`}>
                          {dinero(r.importe)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                          {puedePrecio && r.base_calculo === "cantidad" && r.tipo !== "auxiliar" && (
                            <button
                              onClick={() => setFilaEnPrecio(filaEnPrecio === r.item_id ? null : r.item_id)}
                              className="text-slate-600 underline"
                            >
                              {r.costo_cerrado ? "cambiar" : "precio"}
                            </button>
                          )}
                          {puedeEditar && (
                            <button
                              onClick={() => setFilaEnCantidad(filaEnCantidad === r.item_id ? null : r.item_id)}
                              className="ml-2 text-slate-600 underline"
                            >
                              cantidad
                            </button>
                          )}
                          {puedeEditar && (
                            <button
                              onClick={() => borrarRenglon.mutate(r.item_id)}
                              className="ml-2 text-red-600 underline"
                            >
                              quitar
                            </button>
                          )}
                          {filaEnCantidad === r.item_id && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                if (r.base_calculo === "pct_mano_obra") {
                                  guardarCantidad.mutate({ itemId: r.item_id, cantidad: Number(f.get("porcentaje")) / 100 });
                                } else if (r.tipo === "mano_obra") {
                                  guardarCantidad.mutate({
                                    itemId: r.item_id,
                                    cantidad: Number(f.get("cantidad")),
                                    rendimiento: Number(f.get("rendimiento")) || 1,
                                  });
                                } else {
                                  guardarCantidad.mutate({ itemId: r.item_id, cantidad: Number(f.get("cantidad")) });
                                }
                              }}
                              className="mt-2 grid gap-1 text-left"
                            >
                              {r.base_calculo === "pct_mano_obra" ? (
                                <input
                                  name="porcentaje"
                                  type="number"
                                  step="any"
                                  required
                                  defaultValue={Number(r.cantidad) * 100}
                                  placeholder="% sobre mano de obra"
                                  className="w-40 rounded border border-slate-300 px-2 py-1"
                                />
                              ) : (
                                <input
                                  name="cantidad"
                                  type="number"
                                  step="any"
                                  required
                                  defaultValue={r.cantidad}
                                  placeholder={r.tipo === "mano_obra" ? "Jornadas" : `Cantidad (${r.unidad ?? ""})`}
                                  className="w-40 rounded border border-slate-300 px-2 py-1"
                                />
                              )}
                              {r.tipo === "mano_obra" && r.base_calculo !== "pct_mano_obra" && (
                                <input
                                  name="rendimiento"
                                  type="number"
                                  step="any"
                                  required
                                  defaultValue={r.rendimiento}
                                  placeholder="Rendimiento por jornada"
                                  className="w-40 rounded border border-slate-300 px-2 py-1"
                                />
                              )}
                              <button className="w-40 rounded bg-slate-900 px-2 py-1 text-white">Guardar</button>
                            </form>
                          )}
                          {filaEnPrecio === r.item_id && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                guardarPrecio.mutate({
                                  itemId: r.item_id,
                                  costo: Number(f.get("costo")),
                                  proveedor: String(f.get("proveedor") ?? ""),
                                });
                              }}
                              className="mt-2 grid gap-1 text-left"
                            >
                              <input
                                name="costo"
                                type="number"
                                step="any"
                                required
                                defaultValue={r.costo_cerrado ? r.costo_unitario : undefined}
                                placeholder="Precio autorizado"
                                className="w-40 rounded border border-slate-300 px-2 py-1"
                              />
                              <input
                                name="proveedor"
                                required
                                defaultValue={r.proveedor ?? ""}
                                placeholder="Proveedor"
                                className="w-40 rounded border border-slate-300 px-2 py-1"
                              />
                              <button className="w-40 rounded bg-slate-900 px-2 py-1 text-white">Guardar</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr key={`s-${tipo}`} className="border-t border-slate-100">
                      <td colSpan={3} className="px-3 py-1.5 text-right text-xs uppercase text-slate-500">
                        Subtotal {TITULO_GRUPO[tipo]}
                      </td>
                      <td className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums">{dinero(subtotal)}</td>
                      <td />
                    </tr>
                  </Fragment>
                );
              })}
              {renglones.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    Sin renglones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {guardarPrecio.error && (
          <p className="border-t border-slate-100 px-3 py-2 text-sm text-red-600">
            {(guardarPrecio.error as Error).message}
          </p>
        )}
        {guardarCantidad.error && (
          <p className="border-t border-slate-100 px-3 py-2 text-sm text-red-600">
            {(guardarCantidad.error as Error).message}
          </p>
        )}
        {borrarRenglon.error && (
          <p className="border-t border-slate-100 px-3 py-2 text-sm text-red-600">
            {(borrarRenglon.error as Error).message}
          </p>
        )}

        {puedeEditar && (
          <div className="border-t border-slate-100 p-3">
            {agregando ? (
              <AgregarRenglon analisisId={id} empresaId={pu.empresa_id} onListo={() => setAgregando(false)} />
            ) : (
              <button onClick={() => setAgregando(true)} className="text-sm text-slate-600 underline">
                + Agregar renglón
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="ml-auto max-w-sm text-sm">
          <div className="flex justify-between border-t-2 border-slate-900 py-1.5 font-semibold">
            <span>Costo directo</span>
            <span className="tabular-nums">{dinero(pu.costo_directo)}</span>
          </div>

          {pu.es_auxiliar ? (
            <p className="mt-2 text-xs text-slate-500">
              Análisis básico: se consume dentro de otros a costo directo, sin sobrecosto.
            </p>
          ) : (
            <>
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Indirectos {porcentaje(pu.indirectos_pct)}</span>
                <span className="tabular-nums">{dinero(pu.importe_indirectos)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Financiamiento {porcentaje(pu.financiamiento_pct)}</span>
                <span className="tabular-nums">{dinero(pu.importe_financiamiento)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Utilidad {porcentaje(pu.utilidad_pct)}</span>
                <span className="tabular-nums">{dinero(pu.importe_utilidad)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Cargos adicionales {porcentaje(pu.cargos_adicionales_pct)}</span>
                <span className="tabular-nums">{dinero(pu.importe_cargos_adicionales)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                <span>Precio unitario</span>
                <span className="tabular-nums">{dinero(pu.precio_unitario)}</span>
              </div>
              {pu.factor_nombre ? (
                <p className="mt-1 text-right text-xs text-slate-500">Factor: {pu.factor_nombre}</p>
              ) : (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                  Sin factor asignado: el precio mostrado es sólo costo directo.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {puedeFactor && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-slate-900">Factor de sobrecosto</p>
          <p className="mb-3 text-xs text-slate-500">
            Sólo dirección general define indirectos y utilidad. Para cambiar porcentajes se crea un factor nuevo con
            otra vigencia, para que un PU ya firmado no cambie de precio solo.
          </p>
          <select
            defaultValue=""
            onChange={(e) => e.target.value && asignarFactor.mutate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elige un factor…</option>
            {factores?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre} · ind {porcentaje(f.indirectos_pct)} · util {porcentaje(f.utilidad_pct)}
              </option>
            ))}
          </select>
          {asignarFactor.error && (
            <p className="mt-2 text-sm text-red-600">{(asignarFactor.error as Error).message}</p>
          )}
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        {(acciones.length > 0 || puedeRechazar) && (
          <input
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Comentario para la bitácora (opcional)"
            className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        )}

        <div className="flex flex-wrap gap-2">
          {acciones.map((a) => (
            <button
              key={a.destino}
              onClick={() => mover.mutate(a.destino)}
              disabled={mover.isPending}
              className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${a.tono}`}
            >
              {a.etiqueta}
            </button>
          ))}

          {puedeRechazar && (
            <button
              onClick={() => mover.mutate("borrador")}
              disabled={mover.isPending}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
            >
              Regresar a borrador
            </button>
          )}

          <button
            onClick={async () => {
              setErrorPdf(null);
              setBajando(true);
              try {
                await descargarPdf(pu.analisis_id, pu.codigo);
              } catch (e) {
                setErrorPdf((e as Error).message);
              } finally {
                setBajando(false);
              }
            }}
            disabled={bajando}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            {bajando ? "Generando…" : pu.estado === "publicado" ? "Descargar PDF" : "Ver borrador en PDF"}
          </button>

          {pu.estado === "publicado" && esAdmin && (
            <button
              onClick={() => mover.mutate("obsoleto")}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700"
            >
              Dar de baja
            </button>
          )}
        </div>

        {pu.estado !== "publicado" && (
          <p className="mt-2 text-xs text-slate-500">
            El PDF sale con marca de agua “SIN AUTORIZAR” hasta que el precio se publique.
          </p>
        )}
        {mover.error && <p className="mt-2 text-sm text-red-600">{(mover.error as Error).message}</p>}
        {errorPdf && <p className="mt-2 text-sm text-red-600">{errorPdf}</p>}
      </section>

      <CircuitoFirmas estado={pu.estado} bitacora={bitacora} elaboradoPor={pu.creado_por_nombre} />

      {bitacora.length > 0 && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-slate-900">Bitácora</p>
          <ul className="grid gap-2 text-xs text-slate-600">
            {bitacora.map((b) => (
              <li key={b.id}>
                <span className="font-medium text-slate-900">{ETIQUETA_ESTADO[b.estado_nuevo]}</span> ·{" "}
                {b.actor_nombre ?? "sistema"} · {fechaCorta(b.created_at)}
                {b.comentario && <span className="block text-slate-500">“{b.comentario}”</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
