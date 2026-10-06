import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { ETIQUETA_ESTADO_EPP, htmlResponsivaEpp, porDescontar, semaforoVigencia, valorEnPoder, type LineaEpp } from "../../lib/epp";

// Equipo de protección personal (Mario con Raúl, 5-oct-2026): RH entrega a
// cada trabajador, con cargo a la obra que elija; lo que no hay en bodega se
// pide a compras (requisición normal); responsiva para firma; vigencia con
// semáforo para sustituir; lo perdido se descuenta vía nómina.

interface Asignacion {
  id: string;
  folio: string | null;
  empresa_id: string;
  proyecto_id: string;
  personal_id: string;
  requisicion_id: string | null;
  estatus: string;
  notas: string | null;
  created_at: string;
  epp_asignacion_lineas: LineaEpp[];
}

interface FilaNueva {
  descripcion: string;
  talla: string;
  cantidad: string;
  unidad: string;
  costo: string;
  vigencia: string;
  origen: "bodega" | "compra";
}

const filaVacia = (): FilaNueva => ({ descripcion: "", talla: "", cantidad: "1", unidad: "pza", costo: "", vigencia: "12", origen: "bodega" });
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const campo = "rounded border border-slate-300 px-2 py-1 text-sm";

const CLASE_SEMAFORO: Record<string, string> = {
  vencido: "bg-red-100 text-red-800",
  por_vencer: "bg-amber-100 text-amber-800",
  vigente: "bg-emerald-50 text-emerald-700",
  sin_vigencia: "",
};

export function EquipoProteccion() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [personalId, setPersonalId] = useState("");
  const [proyectoId, setProyectoId] = useState("");
  const [notas, setNotas] = useState("");
  const [filas, setFilas] = useState<FilaNueva[]>([filaVacia()]);
  const [filtro, setFiltro] = useState("");

  const { data: personal } = useQuery({
    queryKey: ["epp-personal"],
    queryFn: async () => {
      const { data, error } = await supabase.from("personal").select("id, nombre, puesto, activo").order("nombre");
      if (error) throw error;
      return (data ?? []).filter((p) => p.activo !== false) as { id: string; nombre: string; puesto: string | null }[];
    },
  });
  const { data: obras } = useQuery({
    queryKey: ["epp-obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre, empresa_id, empresas(codigo, nombre)").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nombre: string; empresa_id: string; empresas: { codigo: string; nombre: string } | null }[];
    },
  });
  const { data: asignaciones, isLoading } = useQuery({
    queryKey: ["epp-asignaciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("epp_asignaciones")
        .select("*, epp_asignacion_lineas(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Asignacion[];
    },
  });
  const { data: requisiciones } = useQuery({
    queryKey: ["epp-requisiciones", (asignaciones ?? []).map((a) => a.requisicion_id).filter(Boolean).join(",")],
    enabled: (asignaciones ?? []).some((a) => a.requisicion_id),
    queryFn: async () => {
      const ids = (asignaciones ?? []).map((a) => a.requisicion_id).filter(Boolean) as string[];
      const { data, error } = await supabase.from("requisiciones").select("id, folio, etapa").in("id", ids);
      if (error) throw error;
      return new Map((data ?? []).map((r: { id: string; folio: number | string | null; etapa: string }) => [r.id, r]));
    },
  });

  const nombrePersona = useMemo(() => new Map((personal ?? []).map((p) => [p.id, p])), [personal]);
  const obraDe = useMemo(() => new Map((obras ?? []).map((o) => [o.id, o])), [obras]);
  const refrescar = () => qc.invalidateQueries({ queryKey: ["epp-asignaciones"] });

  const crear = useMutation({
    mutationFn: async () => {
      const lineas = filas.filter((f) => f.descripcion.trim());
      if (!personalId || !proyectoId) throw new Error("Elige a la persona y la obra a la que se carga.");
      if (!lineas.length) throw new Error("Agrega al menos una pieza de equipo.");
      const { data: a, error } = await supabase
        .from("epp_asignaciones")
        .insert({ personal_id: personalId, proyecto_id: proyectoId, notas: notas.trim() || null, empresa_id: obraDe.get(proyectoId)?.empresa_id })
        .select("id, folio")
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("epp_asignacion_lineas").insert(
        lineas.map((f) => ({
          asignacion_id: a.id,
          empresa_id: obraDe.get(proyectoId)?.empresa_id,
          descripcion: f.descripcion.trim(),
          talla: f.talla.trim() || null,
          cantidad: Number(f.cantidad) || 1,
          unidad: f.unidad.trim() || "pza",
          costo_unitario: Number(f.costo) || 0,
          vigencia_meses: f.vigencia ? Number(f.vigencia) : null,
          origen: f.origen,
        })),
      );
      if (e2) throw e2;
      return a.folio as string;
    },
    onSuccess: (folio) => {
      setAviso(`Entrega ${folio} registrada. Si hay piezas por comprar, usa "Pedir a compras".`);
      setNueva(false);
      setFilas([filaVacia()]);
      setPersonalId("");
      setProyectoId("");
      setNotas("");
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const actualizarLinea = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<LineaEpp> & { devolucion_condicion?: string; sustituye_a?: string } }) => {
      const { error } = await supabase.from("epp_asignacion_lineas").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e: Error) => setError(e.message),
  });

  const sustituir = useMutation({
    mutationFn: async ({ a, l }: { a: Asignacion; l: LineaEpp }) => {
      const { error } = await supabase.from("epp_asignacion_lineas").update({ estado: "sustituido", devolucion_condicion: "danada" }).eq("id", l.id);
      if (error) throw error;
      const { error: e2 } = await supabase.from("epp_asignacion_lineas").insert({
        asignacion_id: a.id,
        empresa_id: a.empresa_id,
        descripcion: l.descripcion,
        talla: l.talla,
        cantidad: l.cantidad,
        unidad: l.unidad,
        costo_unitario: l.costo_unitario,
        vigencia_meses: l.vigencia_meses,
        origen: l.origen,
        sustituye_a: l.id,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      setAviso("Pieza sustituida: quedó una nueva por surtir. Si no hay en bodega, cámbiala a compra y pídela.");
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const pedirCompra = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("fn_epp_pedir_compra", { p_asignacion: id });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Requisición creada en la obra. Alma la ve en Requisiciones para comprarla.");
      refrescar();
      qc.invalidateQueries({ queryKey: ["epp-requisiciones"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function imprimir(a: Asignacion) {
    const ventana = abrirVentanaImpresion();
    const persona = nombrePersona.get(a.personal_id);
    const obra = obraDe.get(a.proyecto_id);
    const html = htmlResponsivaEpp({
      folio: a.folio ?? "",
      fecha: hoy(),
      empresa_nombre: obra?.empresas?.nombre ?? "",
      empresa_codigo: obra?.empresas?.codigo ?? "",
      obra: obra?.nombre ?? "",
      trabajador: persona?.nombre ?? "",
      puesto: persona?.puesto ?? null,
      entrega_nombre: perfil?.nombre ?? null,
      lineas: a.epp_asignacion_lineas,
    });
    if (!abrirParaImprimir(html, ventana)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes e inténtalo de nuevo.");
  }

  const hoyIso = hoy();
  const todas = (asignaciones ?? []).filter((a) => {
    if (!filtro.trim()) return true;
    const t = filtro.trim().toLowerCase();
    return `${a.folio} ${nombrePersona.get(a.personal_id)?.nombre ?? ""} ${obraDe.get(a.proyecto_id)?.nombre ?? ""}`.toLowerCase().includes(t);
  });
  const lineasTodas = (asignaciones ?? []).flatMap((a) => a.epp_asignacion_lineas.map((l) => ({ a, l })));
  const porVencer = lineasTodas.filter(({ l }) => ["vencido", "por_vencer"].includes(semaforoVigencia(l, hoyIso)));
  const descuentos = lineasTodas.filter(({ l }) => l.estado === "perdido" && !l.descuento_aplicado_en);
  const totalDescuentos = porDescontar(lineasTodas.map(({ l }) => l));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Equipo de protección entregado a cada persona, con cargo a la obra. Lo que no hay en bodega se pide a compras.
        </p>
        <button onClick={() => setNueva((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          {nueva ? "Cancelar" : "+ Nueva entrega de EPP"}
        </button>
      </div>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {aviso && (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800" onClick={() => setAviso(null)}>
          {aviso}
        </p>
      )}

      {nueva && (
        <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Persona que recibe
              <select value={personalId} onChange={(e) => setPersonalId(e.target.value)} className={`${campo} mt-1 w-full`}>
                <option value="">Elige…</option>
                {(personal ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.puesto ? ` · ${p.puesto}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Obra a la que se carga el gasto
              <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className={`${campo} mt-1 w-full`}>
                <option value="">Elige…</option>
                {(obras ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.empresas?.codigo ? `${o.empresas.codigo} · ` : ""}
                    {o.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Equipo</th>
                  <th className="pr-2">Talla</th>
                  <th className="pr-2">Cant.</th>
                  <th className="pr-2">Unidad</th>
                  <th className="pr-2">Costo c/u</th>
                  <th className="pr-2">Vigencia (meses)</th>
                  <th className="pr-2">Sale de</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const set = (c: Partial<FilaNueva>) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, ...c } : x)));
                  return (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <input value={f.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Casco, botas, chaleco…" className={`${campo} w-48`} />
                      </td>
                      <td className="pr-2">
                        <input value={f.talla} onChange={(e) => set({ talla: e.target.value })} className={`${campo} w-16`} />
                      </td>
                      <td className="pr-2">
                        <input value={f.cantidad} onChange={(e) => set({ cantidad: e.target.value })} inputMode="decimal" className={`${campo} w-16`} />
                      </td>
                      <td className="pr-2">
                        <input value={f.unidad} onChange={(e) => set({ unidad: e.target.value })} className={`${campo} w-16`} />
                      </td>
                      <td className="pr-2">
                        <input value={f.costo} onChange={(e) => set({ costo: e.target.value })} inputMode="decimal" placeholder="0.00" className={`${campo} w-24`} />
                      </td>
                      <td className="pr-2">
                        <input value={f.vigencia} onChange={(e) => set({ vigencia: e.target.value })} inputMode="numeric" placeholder="sin" className={`${campo} w-16`} />
                      </td>
                      <td className="pr-2">
                        <select value={f.origen} onChange={(e) => set({ origen: e.target.value as FilaNueva["origen"] })} className={campo}>
                          <option value="bodega">Bodega</option>
                          <option value="compra">Comprar</option>
                        </select>
                      </td>
                      <td>
                        {filas.length > 1 && (
                          <button onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))} className="text-xs text-red-600">
                            Quitar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setFilas((fs) => [...fs, filaVacia()])} className="rounded border border-slate-300 px-2 py-1 text-xs">
              + Otra pieza
            </button>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas (opcional)" className={`${campo} flex-1`} />
            <button
              disabled={crear.isPending}
              onClick={() => {
                setError(null);
                crear.mutate();
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {crear.isPending ? "Guardando…" : "Registrar entrega"}
            </button>
          </div>
        </div>
      )}

      {(porVencer.length > 0 || descuentos.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {porVencer.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="mb-1 font-semibold text-amber-900">Por sustituir ({porVencer.length})</p>
              <ul className="space-y-0.5 text-amber-900">
                {porVencer.map(({ a, l }) => (
                  <li key={l.id}>
                    {nombrePersona.get(a.personal_id)?.nombre ?? "—"} · {l.descripcion} · {semaforoVigencia(l, hoyIso) === "vencido" ? "venció" : "vence"} {l.vence_el}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {descuentos.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm">
              <p className="mb-1 font-semibold text-red-900">Por descontar vía nómina · {pesos(totalDescuentos)}</p>
              <ul className="space-y-1 text-red-900">
                {descuentos.map(({ a, l }) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {nombrePersona.get(a.personal_id)?.nombre ?? "—"} · {l.descripcion} · {pesos(l.descuento_monto ?? 0)}
                    </span>
                    <button onClick={() => actualizarLinea.mutate({ id: l.id, cambios: { descuento_aplicado_en: hoyIso } })} className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs">
                      Marcar aplicado en nómina
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por persona, obra o folio" className={`${campo} w-full max-w-sm`} />

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {!isLoading && todas.length === 0 && <p className="text-sm text-slate-500">Sin entregas de EPP todavía.</p>}

      {todas.map((a) => {
        const persona = nombrePersona.get(a.personal_id);
        const obra = obraDe.get(a.proyecto_id);
        const req = a.requisicion_id ? requisiciones?.get(a.requisicion_id) : null;
        const porComprar = a.epp_asignacion_lineas.some((l) => l.origen === "compra" && l.estado === "por_surtir");
        const lineas = [...a.epp_asignacion_lineas].sort((x, y) => x.descripcion.localeCompare(y.descripcion));
        return (
          <div key={a.id} className="rounded border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs text-slate-500">{a.folio}</span>
              <span className="font-semibold text-slate-900">{persona?.nombre ?? "—"}</span>
              <span className="text-xs text-slate-500">
                cargo a {obra?.empresas?.codigo ? `${obra.empresas.codigo} · ` : ""}
                {obra?.nombre ?? "—"}
              </span>
              <span className="text-xs text-slate-500">en su poder {pesos(valorEnPoder(a.epp_asignacion_lineas))}</span>
              {req && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800">Requisición {req.folio ?? ""} · {req.etapa}</span>}
              <span className="flex-1" />
              {porComprar && !a.requisicion_id && (
                <button onClick={() => pedirCompra.mutate(a.id)} disabled={pedirCompra.isPending} className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-800">
                  Pedir a compras
                </button>
              )}
              <button onClick={() => imprimir(a)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                Imprimir responsiva
              </button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {lineas.map((l) => {
                  const sem = semaforoVigencia(l, hoyIso);
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2">
                        {l.descripcion}
                        {l.talla ? <span className="text-xs text-slate-500"> · talla {l.talla}</span> : null}
                        <span className="text-xs text-slate-500">
                          {" "}
                          · {l.cantidad} {l.unidad} · {pesos(l.costo_unitario)} · {l.origen === "compra" ? "compra" : "bodega"}
                        </span>
                      </td>
                      <td className="pr-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 ${CLASE_SEMAFORO[sem]}`}>
                          {ETIQUETA_ESTADO_EPP[l.estado]}
                          {l.estado === "entregado" && l.vence_el ? ` · vence ${l.vence_el}` : ""}
                        </span>
                        {l.estado === "perdido" && (
                          <span className="ml-1 text-red-700">
                            descuento {pesos(l.descuento_monto ?? 0)}
                            {l.descuento_aplicado_en ? ` · aplicado ${l.descuento_aplicado_en}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right text-xs">
                        {l.estado === "por_surtir" && (
                          <>
                            <button onClick={() => actualizarLinea.mutate({ id: l.id, cambios: { estado: "entregado", entregado_en: hoyIso } })} className="mr-1 rounded bg-emerald-700 px-2 py-0.5 text-white">
                              Entregado
                            </button>
                            {!a.requisicion_id && (
                              <button onClick={() => actualizarLinea.mutate({ id: l.id, cambios: { origen: l.origen === "bodega" ? "compra" : "bodega" } })} className="rounded border border-slate-300 px-2 py-0.5">
                                {l.origen === "bodega" ? "No hay: comprar" : "Sí hay en bodega"}
                              </button>
                            )}
                          </>
                        )}
                        {l.estado === "entregado" && (
                          <>
                            <button onClick={() => actualizarLinea.mutate({ id: l.id, cambios: { estado: "devuelto", devolucion_condicion: "buena" } })} className="mr-1 rounded border border-slate-300 px-2 py-0.5">
                              Devolvió
                            </button>
                            <button onClick={() => sustituir.mutate({ a, l })} className="mr-1 rounded border border-amber-300 px-2 py-0.5 text-amber-800">
                              Sustituir
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`¿${l.descripcion} se perdió o no se regresó? Se propone descontar ${pesos(l.cantidad * l.costo_unitario)} vía nómina.`))
                                  actualizarLinea.mutate({ id: l.id, cambios: { estado: "perdido" } });
                              }}
                              className="rounded border border-red-300 px-2 py-0.5 text-red-700"
                            >
                              Perdido
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
