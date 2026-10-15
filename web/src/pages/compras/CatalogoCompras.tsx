import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { CampoBuscador } from "../../components/CampoBuscador";
import { DatosBancariosProveedor } from "../../components/DatosBancariosProveedor";
import { compararPrecios, detalleItem, fechaCortaCatalogo, filtrarContrapartes, filtrarItems, type ContraparteCatalogo, type ItemCatalogo } from "../../lib/buscadorCaptura";
import { csvHistorico, resumenPorConcepto, totalesHistorico, type CompraHistorico } from "../../lib/historicoCostos";

const dinero = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 }));
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

/** Catálogo de compras (Mario, 15-oct-2026): proveedores con su ficha, sus
 * artículos con precio s/IVA (lo que ofrece el buscador de la OC) y el
 * histórico de costos de lo que se les ha comprado; y comparar un artículo
 * entre proveedores. */
export function CatalogoCompras() {
  const [empresa] = useEmpresaFiltro();
  const [pestana, setPestana] = useState<"proveedores" | "articulos">("proveedores");
  const [elegido, setElegido] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const catalogo = useQuery({
    queryKey: ["ordenes-ia-catalogo", false, empresa || "todas"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_ordenes_catalogo_captura", { p_venta: false, p_empresa: empresa || null });
      if (error) throw error;
      const j = (data ?? {}) as { contrapartes?: ContraparteCatalogo[]; items?: ItemCatalogo[] };
      return { contrapartes: j.contrapartes ?? [], items: j.items ?? [] };
    },
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Proveedores y artículos</h1>
      <p className="mb-4 text-sm text-slate-500">Da de alta proveedores y lo que te venden con su precio; aquí ves cuánto les has pagado por cada cosa y cómo ha cambiado. Lo que captures sale en el buscador de las órdenes de compra y servicio.</p>
      <div className="mb-4 flex rounded border border-slate-200 text-sm" style={{ width: "fit-content" }}>
        {(
          [
            ["proveedores", "Proveedores"],
            ["articulos", "Comparar precios"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setPestana(k)} className={`px-3 py-1.5 ${pestana === k ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {catalogo.error && <p className="mb-3 text-sm text-red-600">{(catalogo.error as Error).message}</p>}
      {pestana === "proveedores" ? (
        nuevo || elegido ? (
          <DetalleProveedor
            nombre={elegido}
            items={catalogo.data?.items ?? []}
            onCerrar={() => {
              setNuevo(false);
              setElegido(null);
            }}
            onGuardado={(n) => {
              setNuevo(false);
              setElegido(n);
            }}
          />
        ) : (
          <ListaProveedores cargando={catalogo.isLoading} lista={catalogo.data?.contrapartes ?? []} onElegir={setElegido} onNuevo={() => setNuevo(true)} />
        )
      ) : (
        <CompararArticulos
          items={catalogo.data?.items ?? []}
          onProveedor={(n) => {
            setPestana("proveedores");
            setElegido(n);
          }}
        />
      )}
    </div>
  );
}

function ListaProveedores({ lista, cargando, onElegir, onNuevo }: { lista: ContraparteCatalogo[]; cargando: boolean; onElegir: (nombre: string) => void; onNuevo: () => void }) {
  const { soloConsulta } = useAuth();
  const [texto, setTexto] = useState("");
  const visibles = filtrarContrapartes(lista, texto, 300);
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Busca por nombre o RFC…" className="w-72 rounded border border-slate-300 px-2 py-1 text-sm" />
        <span className="text-xs text-slate-500">{cargando ? "Cargando…" : `${visibles.length} de ${lista.length}`}</span>
        {!soloConsulta && (
          <button type="button" onClick={onNuevo} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
            + Nuevo proveedor
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">RFC</th>
              <th className="px-3 py-2 text-right">Órdenes</th>
              <th className="px-3 py-2">Última</th>
              <th className="px-3 py-2">Ficha</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.nombre} onClick={() => onElegir(c.nombre)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-900">{c.nombre}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{c.rfc ?? ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.veces || ""}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{fechaCortaCatalogo(c.ultima)}</td>
                <td className="px-3 py-2 text-xs">{c.ficha ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">con ficha</span> : <span className="text-slate-400">solo en órdenes</span>}</td>
              </tr>
            ))}
            {!cargando && visibles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">
                  Sin coincidencias. Usa "+ Nuevo proveedor" para darlo de alta.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Ficha {
  id: string;
  nombre: string;
  rfc: string | null;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  giro: string | null;
  notas: string | null;
  activo: boolean;
}

interface Articulo {
  id: string;
  descripcion: string;
  unidad: string | null;
  precio: number | null;
  iva: boolean;
}

function DetalleProveedor({ nombre, items, onCerrar, onGuardado }: { nombre: string | null; items: ItemCatalogo[]; onCerrar: () => void; onGuardado: (nombre: string) => void }) {
  const { soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  // La ficha se busca por la misma clave que datos bancarios y líneas de
  // crédito (fn_proveedor_clave: sin acentos, puntuación ni "SA DE CV").
  const ficha = useQuery({
    queryKey: ["proveedor-ficha", nombre],
    enabled: !!nombre,
    queryFn: async () => {
      const { data: clave, error: e1 } = await supabase.rpc("fn_proveedor_clave", { p_nombre: nombre });
      if (e1) throw e1;
      const [f, b] = await Promise.all([
        supabase.from("proveedores").select("id, nombre, rfc, contacto, telefono, correo, giro, notas, activo").eq("clave", clave as string).maybeSingle(),
        supabase.from("proveedores_datos_bancarios").select("beneficiario, banco, clabe, cuenta, rfc, correo").eq("clave", clave as string).maybeSingle(),
      ]);
      if (f.error) throw f.error;
      return { clave: clave as string, ficha: (f.data ?? null) as Ficha | null, bancarios: b.data as { beneficiario: string | null; banco: string | null; clabe: string | null; cuenta: string | null; rfc: string | null; correo: string | null } | null };
    },
  });
  const f = ficha.data?.ficha ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700">
          ← Proveedores
        </button>
        <h2 className="text-lg font-semibold text-slate-900">{nombre ?? "Nuevo proveedor"}</h2>
        {ficha.data?.bancarios !== undefined && nombre && (
          <span className="ml-2">
            <DatosBancariosProveedor
              key={ficha.data?.clave}
              datos={{ clave: ficha.data?.clave ?? null, nombre, beneficiario_bancario: ficha.data?.bancarios?.beneficiario, banco_proveedor: ficha.data?.bancarios?.banco, clabe: ficha.data?.bancarios?.clabe, cuenta_proveedor: ficha.data?.bancarios?.cuenta, rfc_proveedor: ficha.data?.bancarios?.rfc, correo_proveedor: ficha.data?.bancarios?.correo }}
            />
          </span>
        )}
      </div>
      {nombre && ficha.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <FormFicha
          key={f?.id ?? nombre ?? "nuevo"}
          nombreInicial={nombre}
          ficha={f}
          rfcSugerido={ficha.data?.bancarios?.rfc ?? null}
          soloConsulta={soloConsulta}
          onGuardado={(n) => {
            queryClient.invalidateQueries({ queryKey: ["proveedor-ficha"] });
            queryClient.invalidateQueries({ queryKey: ["ordenes-ia-catalogo"] });
            onGuardado(n);
          }}
        />
      )}
      {nombre && <ArticulosProveedor proveedorId={f?.id ?? null} nombre={nombre} items={items} soloConsulta={soloConsulta} />}
      {nombre && <HistoricoCostos nombre={nombre} proveedorId={f?.id ?? null} soloConsulta={soloConsulta} />}
    </div>
  );
}

function FormFicha({ nombreInicial, ficha, rfcSugerido, soloConsulta, onGuardado }: { nombreInicial: string | null; ficha: Ficha | null; rfcSugerido: string | null; soloConsulta: boolean; onGuardado: (nombre: string) => void }) {
  const [v, setV] = useState({
    nombre: ficha?.nombre ?? nombreInicial ?? "",
    rfc: ficha?.rfc ?? rfcSugerido ?? "",
    contacto: ficha?.contacto ?? "",
    telefono: ficha?.telefono ?? "",
    correo: ficha?.correo ?? "",
    giro: ficha?.giro ?? "",
    notas: ficha?.notas ?? "",
    activo: ficha?.activo ?? true,
  });
  const [aviso, setAviso] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async () => {
      if (!v.nombre.trim()) throw new Error("Escribe el nombre del proveedor.");
      const rfc = v.rfc.trim().toUpperCase();
      if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new Error("El RFC no tiene el formato correcto (12 o 13 caracteres).");
      const fila = { nombre: v.nombre.trim(), rfc: rfc || null, contacto: v.contacto.trim() || null, telefono: v.telefono.trim() || null, correo: v.correo.trim() || null, giro: v.giro.trim() || null, notas: v.notas.trim() || null, activo: v.activo };
      const { error } = ficha ? await supabase.from("proveedores").update(fila).eq("id", ficha.id) : await supabase.from("proveedores").insert(fila);
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ya existe un proveedor con ese nombre en el catálogo." : error.message);
      return fila.nombre;
    },
    onSuccess: (n) => {
      setAviso("Guardado.");
      onGuardado(n);
    },
    onError: (e: Error) => setAviso(e.message),
  });
  const input = (k: keyof typeof v, etiqueta: string, extra = "") => (
    <label className={`text-xs text-slate-600 ${extra}`}>
      {etiqueta}
      <input value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} disabled={soloConsulta} className={`mt-1 ${campo}`} />
    </label>
  );
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">Ficha {ficha ? "" : <span className="font-normal text-slate-500">— aún no tiene; se crea al guardar</span>}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {input("nombre", "Nombre o razón social", "lg:col-span-2")}
        {input("rfc", "RFC")}
        {input("giro", "Giro (material, flete, renta…)")}
        {input("contacto", "Contacto")}
        {input("telefono", "Teléfono")}
        {input("correo", "Correo")}
        <label className="flex items-end gap-2 pb-2 text-xs text-slate-600">
          <input type="checkbox" checked={v.activo} onChange={(e) => setV({ ...v, activo: e.target.checked })} disabled={soloConsulta} /> Activo (sale en el buscador)
        </label>
        {input("notas", "Notas", "sm:col-span-2 lg:col-span-4")}
      </div>
      {!soloConsulta && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => guardar.mutate()} disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {guardar.isPending ? "Guardando…" : ficha ? "Guardar cambios" : "Dar de alta"}
          </button>
          {aviso && <span className={`text-xs ${aviso === "Guardado." ? "text-emerald-700" : "text-red-600"}`}>{aviso}</span>}
        </div>
      )}
    </div>
  );
}

function ArticulosProveedor({ proveedorId, nombre, items, soloConsulta }: { proveedorId: string | null; nombre: string; items: ItemCatalogo[]; soloConsulta: boolean }) {
  const queryClient = useQueryClient();
  const [nueva, setNueva] = useState({ descripcion: "", unidad: "", precio: "", iva: true });
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ["proveedor-articulos", proveedorId],
    enabled: !!proveedorId,
    queryFn: async () => {
      const { data, error } = await supabase.from("proveedor_articulos").select("id, descripcion, unidad, precio, iva").eq("proveedor_id", proveedorId!).eq("activo", true).order("descripcion");
      if (error) throw error;
      return (data ?? []) as Articulo[];
    },
  });
  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["proveedor-articulos", proveedorId] });
    queryClient.invalidateQueries({ queryKey: ["ordenes-ia-catalogo"] });
  };
  const agregar = useMutation({
    mutationFn: async () => {
      if (!proveedorId) throw new Error("Primero da de alta la ficha del proveedor.");
      if (!nueva.descripcion.trim()) throw new Error("Escribe el artículo o servicio.");
      const precio = nueva.precio === "" ? null : Number(nueva.precio);
      if (precio != null && !(precio >= 0)) throw new Error("El precio no es válido.");
      const { error } = await supabase.from("proveedor_articulos").insert({ proveedor_id: proveedorId, descripcion: nueva.descripcion.trim(), unidad: nueva.unidad.trim() || null, precio, iva: nueva.iva });
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ese artículo ya está en la lista de este proveedor." : error.message);
    },
    onSuccess: () => {
      setNueva({ descripcion: "", unidad: "", precio: "", iva: true });
      setAviso(null);
      invalidar();
    },
    onError: (e: Error) => setAviso(e.message),
  });
  const actualizar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<Articulo> }) => {
      const { error } = await supabase.from("proveedor_articulos").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setAviso(e.message),
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proveedor_articulos").update({ activo: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setAviso(e.message),
  });
  // Al escribir, sugiere lo que ya se le ha comprado (con su último precio).
  const sugeridas = buscando ? filtrarItems(items, nueva.descripcion, nombre, 10, true) : [];

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Artículos y precios de lista</h3>
      <p className="mb-3 text-xs text-slate-500">Precio unitario SIN IVA. Es lo que se ofrece primero en el buscador de la orden cuando eliges este proveedor.</p>
      {!proveedorId ? (
        <p className="text-sm text-slate-500">Da de alta la ficha (arriba) para agregarle artículos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-2">Artículo / servicio</th>
                <th className="py-1 pr-2">Unidad</th>
                <th className="py-1 pr-2 text-right">Precio s/IVA</th>
                <th className="py-1 pr-2 text-center">IVA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(lista.data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{a.descripcion}</td>
                  <td className="py-1 pr-2">{a.unidad ?? ""}</td>
                  <td className="py-1 pr-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={a.precio ?? ""}
                      disabled={soloConsulta}
                      onBlur={(e) => {
                        const p = e.target.value === "" ? null : Number(e.target.value);
                        if (p !== (a.precio == null ? null : Number(a.precio))) actualizar.mutate({ id: a.id, cambios: { precio: p } });
                      }}
                      className="w-28 rounded border border-slate-200 px-1.5 py-1 text-right"
                    />
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input type="checkbox" checked={a.iva} disabled={soloConsulta} onChange={(e) => actualizar.mutate({ id: a.id, cambios: { iva: e.target.checked } })} />
                  </td>
                  <td className="py-1 text-right">
                    {!soloConsulta && (
                      <button type="button" onClick={() => quitar.mutate(a.id)} className="text-xs text-red-600">
                        quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!soloConsulta && (
                <tr className="border-t border-slate-200">
                  <td className="py-1.5 pr-2">
                    <CampoBuscador
                      value={nueva.descripcion}
                      onChange={(d) => {
                        setBuscando(true);
                        setNueva({ ...nueva, descripcion: d });
                      }}
                      opciones={sugeridas.map((x, k) => ({ clave: String(k), titulo: x.descripcion, detalle: detalleItem(x, false) }))}
                      onElegir={(k) => {
                        const x = sugeridas[Number(k)];
                        if (x) setNueva({ descripcion: x.descripcion, unidad: nueva.unidad || x.unidad || "", precio: nueva.precio || (x.precio != null ? String(x.precio) : ""), iva: x.iva ?? true });
                        setBuscando(false);
                      }}
                      placeholder="Nuevo artículo (o elige uno ya comprado)"
                      className="w-full min-w-[16rem] rounded border border-slate-300 px-1.5 py-1"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input value={nueva.unidad} onChange={(e) => setNueva({ ...nueva, unidad: e.target.value })} placeholder="PZA" className="w-20 rounded border border-slate-300 px-1.5 py-1" />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <input type="number" min="0" step="0.01" value={nueva.precio} onChange={(e) => setNueva({ ...nueva, precio: e.target.value })} className="w-28 rounded border border-slate-300 px-1.5 py-1 text-right" />
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <input type="checkbox" checked={nueva.iva} onChange={(e) => setNueva({ ...nueva, iva: e.target.checked })} />
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => agregar.mutate()} disabled={agregar.isPending} className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                      Agregar
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {aviso && <p className="mt-2 text-xs text-red-600">{aviso}</p>}
    </div>
  );
}

function HistoricoCostos({ nombre, proveedorId, soloConsulta }: { nombre: string; proveedorId: string | null; soloConsulta: boolean }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const hist = useQuery({
    queryKey: ["proveedor-historico", nombre],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_proveedor_historico_costos", { p_proveedor: nombre });
      if (error) throw error;
      return ((data ?? []) as CompraHistorico[]).map((c) => ({ ...c, precio: Number(c.precio), cantidad: c.cantidad == null ? null : Number(c.cantidad) }));
    },
  });
  const resumen = useMemo(() => resumenPorConcepto(hist.data ?? []), [hist.data]);
  const visibles = useMemo(() => {
    const ws = texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
    return ws.length ? resumen.filter((r) => ws.every((w) => r.clave.toLowerCase().includes(w))) : resumen;
  }, [resumen, texto]);
  const t = totalesHistorico(resumen);
  const aLista = useMutation({
    mutationFn: async (r: { descripcion: string; unidad: string | null; ultimo: number; iva: boolean }) => {
      if (!proveedorId) throw new Error("Primero da de alta la ficha del proveedor.");
      const { error } = await supabase.from("proveedor_articulos").insert({ proveedor_id: proveedorId, descripcion: r.descripcion, unidad: r.unidad, precio: r.ultimo, iva: r.iva });
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ya está en la lista." : error.message);
    },
    onSuccess: () => {
      setAviso(null);
      queryClient.invalidateQueries({ queryKey: ["proveedor-articulos", proveedorId] });
      queryClient.invalidateQueries({ queryKey: ["ordenes-ia-catalogo"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  function descargar() {
    const url = URL.createObjectURL(new Blob([csvHistorico(nombre, hist.data ?? [])], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-costos-${nombre.replace(/[^\w]+/g, "-").slice(0, 40)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Histórico de costos</h3>
        <span className="text-xs text-slate-500">
          {t.conceptos} conceptos · {t.compras} compras · {dinero(t.importe)} s/IVA · <span className="text-red-700">▲ {t.subieron} subieron</span> · <span className="text-emerald-700">▼ {t.bajaron} bajaron</span>
        </span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Filtrar concepto…" className="ml-auto w-48 rounded border border-slate-300 px-2 py-1 text-xs" />
        <button type="button" onClick={descargar} disabled={!hist.data?.length} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 disabled:opacity-50">
          Excel
        </button>
      </div>
      <p className="mb-2 text-xs text-slate-500">Precios unitarios SIN IVA de las órdenes de compra a este proveedor (las del backoffice traen el IVA dentro y aquí se quita). La variación es contra el último precio distinto.</p>
      {hist.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {hist.error && <p className="text-sm text-red-600">{(hist.error as Error).message}</p>}
      {aviso && <p className="mb-2 text-xs text-red-600">{aviso}</p>}
      {!hist.isLoading && resumen.length === 0 && <p className="text-sm text-slate-400">Sin compras registradas a este proveedor.</p>}
      {visibles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-2">Concepto</th>
                <th className="py-1 pr-2">Unidad</th>
                <th className="py-1 pr-2 text-right">Compras</th>
                <th className="py-1 pr-2 text-right">Último</th>
                <th className="py-1 pr-2 text-right">Anterior</th>
                <th className="py-1 pr-2 text-right">Variación</th>
                <th className="py-1 pr-2 text-right">Mín · máx</th>
                <th className="py-1 pr-2 text-right">Promedio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <FilaHistorico
                  key={r.clave}
                  r={r}
                  abierto={abierto === r.clave}
                  onAbrir={() => setAbierto(abierto === r.clave ? null : r.clave)}
                  onALista={soloConsulta || !proveedorId ? null : () => aLista.mutate({ descripcion: r.descripcion, unidad: r.unidad, ultimo: r.ultimo, iva: r.historial[0]?.iva ?? true })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaHistorico({ r, abierto, onAbrir, onALista }: { r: ReturnType<typeof resumenPorConcepto>[number]; abierto: boolean; onAbrir: () => void; onALista: (() => void) | null }) {
  const sube = r.variacion != null && r.variacion > 0;
  const baja = r.variacion != null && r.variacion < 0;
  return (
    <>
      <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={onAbrir}>
        <td className="py-1.5 pr-2">{r.descripcion}</td>
        <td className="py-1.5 pr-2 text-xs text-slate-500">{r.unidad ?? ""}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">{r.compras}</td>
        <td className="py-1.5 pr-2 text-right tabular-nums">
          {dinero(r.ultimo)}
          <div className="text-[11px] text-slate-400">{fechaCortaCatalogo(r.ultimaFecha)}</div>
        </td>
        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">
          {r.anterior != null ? dinero(r.anterior) : "—"}
          {r.anteriorFecha && <div className="text-[11px] text-slate-400">{fechaCortaCatalogo(r.anteriorFecha)}</div>}
        </td>
        <td className={`py-1.5 pr-2 text-right tabular-nums font-medium ${sube ? "text-red-700" : baja ? "text-emerald-700" : "text-slate-400"}`}>{r.variacion == null ? "—" : `${sube ? "▲" : "▼"} ${Math.abs(r.variacion)} %`}</td>
        <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-slate-600">
          {dinero(r.minimo)} · {dinero(r.maximo)}
        </td>
        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{dinero(r.promedio)}</td>
        <td className="py-1.5 text-right">
          {onALista && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onALista();
              }}
              className="whitespace-nowrap text-xs text-slate-700 underline"
              title="Agregarlo a la lista de artículos con el último precio"
            >
              a la lista
            </button>
          )}
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-left uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Orden</th>
                  <th className="py-1 pr-2">Empresa</th>
                  <th className="py-1 pr-2">Proyecto</th>
                  <th className="py-1 pr-2 text-right">Cantidad</th>
                  <th className="py-1 pr-2 text-right">Precio s/IVA</th>
                </tr>
              </thead>
              <tbody>
                {r.historial.map((c, i) => (
                  <tr key={`${c.folio}-${i}`} className="border-t border-slate-200">
                    <td className="py-1 pr-2">{c.fecha}</td>
                    <td className="py-1 pr-2 font-mono">{c.folio}</td>
                    <td className="py-1 pr-2">{c.empresa ?? ""}</td>
                    <td className="py-1 pr-2">{c.proyecto ?? ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{c.cantidad ?? ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{dinero(c.precio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function CompararArticulos({ items, onProveedor }: { items: ItemCatalogo[]; onProveedor: (nombre: string) => void }) {
  const [texto, setTexto] = useState("");
  const filas = compararPrecios(items, texto);
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="¿Qué buscas? p. ej. varilla 3/8, cemento, flete…" className="w-96 max-w-full rounded border border-slate-300 px-2 py-1 text-sm" autoFocus />
        <span className="text-xs text-slate-500">Último precio s/IVA de cada proveedor, del más barato al más caro.</span>
      </div>
      {texto.trim() === "" ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">Escribe un artículo para ver quién lo vende y a cuánto.</p>
      ) : filas.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">Nadie lo ha vendido todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Artículo</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Último precio s/IVA</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Veces</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((i, k) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{i.descripcion}</td>
                  <td className="px-3 py-1.5">
                    {i.contraparte ? (
                      <button type="button" onClick={() => onProveedor(i.contraparte!)} className="text-left text-slate-800 underline decoration-slate-300 hover:decoration-slate-700">
                        {i.contraparte}
                      </button>
                    ) : (
                      <span className="text-slate-400">catálogo</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{i.unidad ?? ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{dinero(i.precio)}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{fechaCortaCatalogo(i.ultima)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.veces || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
