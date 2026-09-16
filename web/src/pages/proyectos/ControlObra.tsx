import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type {
  NominaApiControlObra,
  Proyecto,
  ProyectoControl,
  ProyectoControlCompra,
  ProyectoControlEstatus,
  ProyectoControlNomina,
} from "../../types/database";

// Control de obra por especialidad: trae a la app el "Control de Proyectos —
// Carpintería" (Portamar). Cada control tiene contrato, compras y nómina
// semanal propios; con eso sale el avance de presupuesto y, al cierre, la
// utilidad y el margen. La nómina se muestra por dos lados: la que decide
// pagar la dirección (capturada aquí) y la que la API de mano de obra tiene
// cargada al proyecto para esa subpartida.

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";
const botonPrimario = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const botonSecundario = "rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fecha = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const ESTATUS: Record<ProyectoControlEstatus, string> = { en_curso: "En curso", cierre: "En cierre", cerrado: "Cerrado" };

function oVacio(fd: FormData, campo: string) {
  const v = String(fd.get(campo) ?? "").trim();
  return v === "" ? null : v;
}

export function PestanaControlObra({ proyecto }: { proyecto: Proyecto }) {
  const { perfil } = useAuth();
  const puedeEditar = perfil?.rol === "admin" || perfil?.rol === "corporativo";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const { data: controles, isLoading } = useQuery({
    queryKey: ["proyecto-controles", proyecto.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyecto_controles").select("*").eq("proyecto_id", proyecto.id).order("created_at");
      if (error) throw error;
      return data as ProyectoControl[];
    },
  });

  const crear = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("proyecto_controles").insert({
        proyecto_id: proyecto.id,
        especialidad: fd.get("especialidad"),
        presupuesto: Number(fd.get("presupuesto")),
        fecha_inicio: oVacio(fd, "fecha_inicio"),
        subpartida_nomina: oVacio(fd, "subpartida_nomina"),
        creado_por: perfil?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proyecto-controles", proyecto.id] });
      setNuevo(false);
    },
    onError: (err) => setError((err as Error).message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div className="space-y-6">
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {controles?.map((c) => <ControlObra key={c.id} control={c} puedeEditar={puedeEditar} />)}

      {controles?.length === 0 && !nuevo && (
        <p className="text-sm text-slate-500">Este proyecto todavía no tiene un control de obra por especialidad (contrato, compras y nómina propios).</p>
      )}

      {puedeEditar && !nuevo && (
        <button onClick={() => setNuevo(true)} className={botonSecundario}>
          + Nuevo control (otra especialidad)
        </button>
      )}
      {puedeEditar && nuevo && (
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            setError(null);
            crear.mutate(new FormData(e.currentTarget));
          }}
          className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-4"
        >
          <div>
            <label className={etiquetaCampo}>Especialidad</label>
            <input name="especialidad" required className={campoTexto} placeholder="Carpintería" />
          </div>
          <div>
            <label className={etiquetaCampo}>Contrato / presupuesto</label>
            <input name="presupuesto" type="number" step="0.01" min="0" required className={campoTexto} placeholder="130000" />
          </div>
          <div>
            <label className={etiquetaCampo}>Inicio</label>
            <input name="fecha_inicio" type="date" className={campoTexto} />
          </div>
          <div>
            <label className={etiquetaCampo}>Subpartida en la API de mano de obra</label>
            <input name="subpartida_nomina" className={campoTexto} placeholder="Carpintería" />
          </div>
          <div className="flex gap-2 sm:col-span-4">
            <button disabled={crear.isPending} className={botonPrimario}>
              {crear.isPending ? "Guardando…" : "Crear control"}
            </button>
            <button type="button" onClick={() => setNuevo(false)} className={botonSecundario}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ControlObra({ control, puedeEditar }: { control: ProyectoControl; puedeEditar: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: compras } = useQuery({
    queryKey: ["control-compras", control.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyecto_control_compras").select("*").eq("control_id", control.id).order("fecha");
      if (error) throw error;
      return data as ProyectoControlCompra[];
    },
  });
  const { data: nomina } = useQuery({
    queryKey: ["control-nomina", control.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyecto_control_nomina").select("*").eq("control_id", control.id).order("semana").order("puesto");
      if (error) throw error;
      return data as ProyectoControlNomina[];
    },
  });
  const { data: nominaApi } = useQuery({
    queryKey: ["control-nomina-api", control.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nomina_api_control_obra", { p_control_id: control.id });
      if (error) throw error;
      return data as NominaApiControlObra[];
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["control-compras", control.id] });
    queryClient.invalidateQueries({ queryKey: ["control-nomina", control.id] });
    queryClient.invalidateQueries({ queryKey: ["proyecto-controles", control.proyecto_id] });
  };
  const alError = (err: unknown) => setError((err as Error).message);

  const agregarCompra = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("proyecto_control_compras").insert({
        control_id: control.id,
        fecha: fd.get("fecha"),
        proveedor: fd.get("proveedor"),
        folio: oVacio(fd, "folio"),
        descripcion: oVacio(fd, "descripcion"),
        categoria: oVacio(fd, "categoria"),
        estatus: fd.get("estatus"),
        importe: Number(fd.get("importe")),
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: alError,
  });
  const agregarNomina = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("proyecto_control_nomina").insert({
        control_id: control.id,
        semana: Number(fd.get("semana")),
        fecha_inicio: fd.get("fecha_inicio"),
        fecha_fin: fd.get("fecha_fin"),
        puesto: fd.get("puesto"),
        sueldo: Number(fd.get("sueldo")),
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: alError,
  });
  const borrar = useMutation({
    mutationFn: async ({ tabla, id }: { tabla: "proyecto_control_compras" | "proyecto_control_nomina"; id: string }) => {
      const { error } = await supabase.from(tabla).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: alError,
  });
  const cambiarEstatus = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase
        .from("proyecto_controles")
        .update({ estatus: fd.get("estatus"), semana_cierre: oVacio(fd, "semana_cierre"), presupuesto: Number(fd.get("presupuesto")) })
        .eq("id", control.id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: alError,
  });

  const presupuesto = Number(control.presupuesto);
  const materiales = (compras ?? []).reduce((s, c) => s + Number(c.importe), 0);
  const nominaTotal = (nomina ?? []).reduce((s, n) => s + Number(n.sueldo), 0);
  const total = materiales + nominaTotal;
  const disponible = presupuesto - total;
  const avance = presupuesto > 0 ? total / presupuesto : 0;
  const semanas = (nomina ?? []).reduce((m, n) => Math.max(m, n.semana), 0);
  const cerrado = control.estatus !== "en_curso";
  const margen = presupuesto > 0 ? disponible / presupuesto : 0;
  const colorAvance = avance < 0.7 ? "bg-emerald-500" : avance <= 1 ? "bg-amber-500" : "bg-red-500";

  // Nómina según la API, agrupada por semana de la API (Num_sem del año).
  const apiPorSemana = new Map<number, { fecha_inicio: string; fecha_fin: string; nombres: string[]; monto: number }>();
  for (const r of nominaApi ?? []) {
    const s = apiPorSemana.get(r.semana) ?? { fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin, nombres: [], monto: 0 };
    s.nombres.push(r.nombre);
    s.monto += Number(r.monto);
    apiPorSemana.set(r.semana, s);
  }
  const apiTotal = [...apiPorSemana.values()].reduce((s, x) => s + x.monto, 0);
  const diferenciaNomina = nominaTotal - apiTotal;

  const enviar = (m: { mutate: (fd: FormData) => void }) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    m.mutate(new FormData(e.currentTarget));
    e.currentTarget.reset();
  };

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {control.especialidad}{" "}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${cerrado ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
            {ESTATUS[control.estatus]}
            {control.semana_cierre && ` · semana del ${control.semana_cierre}`}
          </span>
        </h2>
        <p className="text-xs text-slate-500">Inicio {fecha(control.fecha_inicio)}</p>
      </div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {cerrado && (
        <div className="mb-4 rounded bg-slate-900 px-4 py-3 text-sm text-slate-100">
          <p className="font-semibold">Resumen de cierre — {control.especialidad}</p>
          <p className="mt-1 text-slate-300">
            {semanas} semanas de trabajo. Costo total de materiales y nómina <strong className="text-white">{mxn.format(total)}</strong> contra un contrato de{" "}
            <strong className="text-white">{mxn.format(presupuesto)}</strong>: utilidad de <strong className="text-white">{mxn.format(disponible)}</strong> (margen{" "}
            <strong className="text-white">{pct(margen)}</strong>).
          </p>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi etiqueta="Contrato / presupuesto" valor={mxn.format(presupuesto)} />
        <Kpi etiqueta={cerrado ? "Costo total" : "Gastado a la fecha"} valor={mxn.format(total)} sub={`Materiales ${mxn.format(materiales)} · Nómina ${mxn.format(nominaTotal)}`} />
        <Kpi etiqueta={cerrado ? "Utilidad" : "Disponible"} valor={mxn.format(disponible)} sub={`${pct(avance)} del presupuesto usado`} tono={disponible < 0 ? "rojo" : "verde"} />
        <Kpi etiqueta={cerrado ? "Margen" : "Semanas trabajadas"} valor={cerrado ? pct(margen) : String(semanas)} sub={cerrado ? `${semanas} semanas` : undefined} tono={cerrado ? "verde" : undefined} />
      </div>

      <div className="mb-5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full ${colorAvance}`} style={{ width: `${Math.min(avance, 1) * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{mxn.format(total)} gastado</span>
          <span>{mxn.format(presupuesto)} presupuesto</span>
        </div>
      </div>

      {/* Compras */}
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Compras / materiales</h3>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Estatus</th>
              <th className="px-3 py-2 text-right">Importe</th>
              {puedeEditar && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {compras?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{fecha(c.fecha)}</td>
                <td className="px-3 py-2">{c.proveedor}</td>
                <td className="px-3 py-2 whitespace-nowrap">{c.folio ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.descripcion ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.estatus === "pagado" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {c.estatus === "pagado" ? "Pagado" : "Pendiente"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{mxn.format(Number(c.importe))}</td>
                {puedeEditar && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => borrar.mutate({ tabla: "proyecto_control_compras", id: c.id })} className="text-xs text-slate-400 hover:text-red-600">
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {compras?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400">Sin compras registradas.</td>
              </tr>
            )}
          </tbody>
          {compras && compras.length > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right">Materiales</td>
                <td className="px-3 py-2 text-right tabular-nums">{mxn.format(materiales)}</td>
                {puedeEditar && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {puedeEditar && (
        <form onSubmit={enviar(agregarCompra)} className="mt-2 grid gap-2 rounded bg-slate-50 p-3 sm:grid-cols-6">
          <input name="fecha" type="date" required className={campoTexto} />
          <input name="proveedor" required className={campoTexto} placeholder="Proveedor" />
          <input name="folio" className={campoTexto} placeholder="Folio / OC" />
          <input name="descripcion" className={campoTexto} placeholder="Descripción" />
          <select name="estatus" defaultValue="pagado" className={campoTexto}>
            <option value="pagado">Pagado</option>
            <option value="pendiente">Pendiente</option>
          </select>
          <div className="flex gap-2">
            <input name="importe" type="number" step="0.01" min="0" required className={campoTexto} placeholder="Importe" />
            <button disabled={agregarCompra.isPending} className={botonPrimario}>+</button>
          </div>
        </form>
      )}

      {/* Nómina */}
      <h3 className="mt-5 mb-2 text-sm font-semibold text-slate-700">Nómina por semana (lo que se paga)</h3>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Semana</th>
              <th className="px-3 py-2">Periodo</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2 text-right">Sueldo</th>
              {puedeEditar && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {nomina?.map((n) => (
              <tr key={n.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{n.semana}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fecha(n.fecha_inicio)} – {fecha(n.fecha_fin)}</td>
                <td className="px-3 py-2">{n.puesto}</td>
                <td className="px-3 py-2 text-right tabular-nums">{mxn.format(Number(n.sueldo))}</td>
                {puedeEditar && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => borrar.mutate({ tabla: "proyecto_control_nomina", id: n.id })} className="text-xs text-slate-400 hover:text-red-600">
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {nomina?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">Sin nómina registrada.</td>
              </tr>
            )}
          </tbody>
          {nomina && nomina.length > 0 && (
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right">Nómina</td>
                <td className="px-3 py-2 text-right tabular-nums">{mxn.format(nominaTotal)}</td>
                {puedeEditar && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {puedeEditar && (
        <form onSubmit={enviar(agregarNomina)} className="mt-2 grid gap-2 rounded bg-slate-50 p-3 sm:grid-cols-6">
          <input name="semana" type="number" min="1" required className={campoTexto} placeholder="Semana" defaultValue={semanas + 1} />
          <input name="fecha_inicio" type="date" required className={campoTexto} />
          <input name="fecha_fin" type="date" required className={campoTexto} />
          <input name="puesto" required className={campoTexto} placeholder="Puesto" />
          <input name="sueldo" type="number" step="0.01" min="0" required className={campoTexto} placeholder="Sueldo" />
          <button disabled={agregarNomina.isPending} className={botonPrimario}>+ Semana</button>
        </form>
      )}

      {/* Cruce con la API de mano de obra */}
      {control.subpartida_nomina && (
        <div className="mt-5 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Mano de obra cargada en la API (subpartida "{control.subpartida_nomina}")</h3>
            <p className="text-sm">
              <span className="text-slate-500">API:</span> <strong>{mxn.format(apiTotal)}</strong>
              {nominaApi && nominaApi.length > 0 && (
                <span className={`ml-2 text-xs ${Math.abs(diferenciaNomina) < 1 ? "text-emerald-700" : "text-amber-700"}`}>
                  {Math.abs(diferenciaNomina) < 1 ? "coincide con lo pagado" : `${diferenciaNomina > 0 ? "+" : "−"}${mxn.format(Math.abs(diferenciaNomina))} vs. lo pagado`}
                </span>
              )}
            </p>
          </div>
          {apiPorSemana.size > 0 ? (
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Sem. API</th>
                  <th className="px-2 py-1">Periodo</th>
                  <th className="px-2 py-1">Personal</th>
                  <th className="px-2 py-1 text-right">Cargado</th>
                </tr>
              </thead>
              <tbody>
                {[...apiPorSemana.entries()].map(([sem, x]) => (
                  <tr key={sem} className="border-t border-slate-200">
                    <td className="px-2 py-1">{sem}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{fecha(x.fecha_inicio)} – {fecha(x.fecha_fin)}</td>
                    <td className="px-2 py-1 text-slate-600">{[...new Set(x.nombres)].join(", ")}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{mxn.format(x.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-xs text-slate-500">La API no tiene mano de obra de esta subpartida cargada al proyecto (o aún no se ha sincronizado).</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            La API prorratea el sueldo cuando la cuadrilla se reparte entre obras; la tabla de arriba es lo que la dirección decide pagar. Ambas cifras se muestran para que el
            cierre no dependa de una sola.
          </p>
        </div>
      )}

      {puedeEditar && (
        <form onSubmit={enviar(cambiarEstatus)} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div>
            <label className={etiquetaCampo}>Estatus</label>
            <select name="estatus" defaultValue={control.estatus} className={campoTexto}>
              {(Object.keys(ESTATUS) as ProyectoControlEstatus[]).map((k) => (
                <option key={k} value={k}>{ESTATUS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiquetaCampo}>Semana de cierre</label>
            <input name="semana_cierre" defaultValue={control.semana_cierre ?? ""} className={campoTexto} placeholder="08 al 14-sep-2026" />
          </div>
          <div>
            <label className={etiquetaCampo}>Contrato / presupuesto</label>
            <input name="presupuesto" type="number" step="0.01" min="0" defaultValue={presupuesto} className={campoTexto} />
          </div>
          <button disabled={cambiarEstatus.isPending} className={botonSecundario}>Guardar</button>
        </form>
      )}
      {control.notas && <p className="mt-3 text-xs text-slate-500">{control.notas}</p>}
    </section>
  );
}

function Kpi({ etiqueta, valor, sub, tono }: { etiqueta: string; valor: string; sub?: string; tono?: "verde" | "rojo" }) {
  const color = tono === "verde" ? "text-emerald-700" : tono === "rojo" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
