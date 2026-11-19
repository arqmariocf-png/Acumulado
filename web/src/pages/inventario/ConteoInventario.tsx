import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { CampoBuscador, type OpcionBuscador } from "../../components/CampoBuscador";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { descargarCsv } from "../../lib/descargarArchivo";
import {
  administraConteo, csvConteo, fechaHoyMx, filtrarItems, filtrarProductos, htmlEtiquetas, nombreExcelConteo, resumenConteo, revisarItem, UNIDADES_CONTEO, urlEtiqueta, urlEtiquetaProducto,
  type ConteoInventario as Conteo, type EtiquetaConteo, type ItemConteo,
} from "../../lib/conteoInventario";

// Conteo físico de inventario (19-nov-2026, Mario: "todos van a contar y
// subir códigos con los ítems existentes, así como códigos QR para tener
// todos los ítems identificados… registra la fecha y los ítems que harán
// todos y cada uno y también a las empresas que pertenece el inventario").
// Cualquiera de la organización captura a su nombre; cada ítem recibe su
// código INV-<EMPRESA>-0001 y su etiqueta QR (la liga abre el ítem aquí).

interface Empresa {
  id: string;
  nombre: string;
  codigo: string;
}
interface Producto {
  id: string;
  sku: string | null;
  nombre: string;
  unidad_medida: string | null;
  codigo_barras: string | null;
}

const UBICACION_KEY = "conteo-inventario-ubicacion";

function QrSvg({ texto, className }: { texto: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let vivo = true;
    import("qrcode")
      .then((Q) => Q.toString(texto, { type: "svg", errorCorrectionLevel: "M", margin: 0 }))
      .then((s) => {
        if (vivo) setSvg(s);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [texto]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, d)));
}

export function ConteoInventario() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const itemEscaneado = params.get("item");
  const productoEscaneado = params.get("producto");
  const hoy = fechaHoyMx();
  const administra = administraConteo(perfil?.rol);

  const { data: conteo, isLoading: cargandoConteo } = useQuery({
    queryKey: ["conteo-inventario-actual"],
    enabled: !!perfil,
    queryFn: async () => {
      // El abierto más reciente; si no hay, el último (cerrado) para consultarlo.
      const { data, error } = await supabase.from("conteos_inventario").select("id, fecha, nombre, instrucciones, estado").order("estado", { ascending: true }).order("fecha", { ascending: false }).limit(1);
      if (error) throw error;
      return ((data ?? [])[0] as Conteo | undefined) ?? null;
    },
  });
  const { data: empresas } = useQuery({
    queryKey: ["empresas-conteo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.nombre])), [empresas]);
  const codigoEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo])), [empresas]);

  const { data: items, isLoading: cargandoItems } = useQuery({
    queryKey: ["conteo-items", conteo?.id],
    enabled: !!conteo,
    refetchInterval: 30_000,
    queryFn: async () => {
      const todo: ItemConteo[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await supabase
          .from("conteo_items")
          .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, codigo_barras, notas, producto_id, contado_por, contado_por_nombre, created_at")
          .eq("conteo_id", conteo!.id)
          .order("created_at", { ascending: false })
          .range(desde, desde + 999);
        if (error) throw error;
        const pagina = (data ?? []) as ItemConteo[];
        todo.push(...pagina.map((i) => ({ ...i, cantidad: Number(i.cantidad) })));
        if (pagina.length < 1000) break;
      }
      return todo;
    },
  });

  // ── Captura ──────────────────────────────────────────────────────────
  const [empresaId, setEmpresaId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [unidad, setUnidad] = useState("pza");
  const [ubicacion, setUbicacion] = useState(() => {
    try {
      return localStorage.getItem(UBICACION_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [codigoBarras, setCodigoBarras] = useState("");
  const [notas, setNotas] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<ItemConteo | null>(null);
  const refDescripcion = useRef<HTMLInputElement | null>(null);
  const refCantidad = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!empresaId && empresas?.length) {
      const propia = perfil?.empresa_id && empresas.some((e) => e.id === perfil.empresa_id) ? perfil.empresa_id : empresas[0].id;
      setEmpresaId(propia);
    }
  }, [empresas, empresaId, perfil?.empresa_id]);

  const { data: productos } = useQuery({
    queryKey: ["productos-conteo", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("productos").select("id, sku, nombre, unidad_medida, codigo_barras").eq("empresa_id", empresaId).eq("activo", true).order("nombre").limit(1000);
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });
  const opcionesProducto: OpcionBuscador[] = useMemo(
    () => (productos ?? []).map((p) => ({ clave: p.id, titulo: p.nombre, detalle: [p.unidad_medida, p.codigo_barras].filter(Boolean).join(" · ") || undefined })),
    [productos],
  );

  // QR de un artículo del catálogo: llena la captura con ese producto y deja
  // el cursor en la cantidad (una sola vez por carga).
  const productoPrellenado = useRef<string | null>(null);
  useEffect(() => {
    if (!productoEscaneado || productoPrellenado.current === productoEscaneado) return;
    productoPrellenado.current = productoEscaneado;
    supabase
      .from("productos")
      .select("id, empresa_id, sku, nombre, unidad_medida, codigo_barras")
      .eq("id", productoEscaneado)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as (Producto & { empresa_id: string }) | null;
        if (!p) return setError("No se encontró ese artículo del catálogo.");
        setEmpresaId(p.empresa_id);
        setDescripcion(p.nombre);
        setProductoId(p.id);
        if (p.unidad_medida) setUnidad(p.unidad_medida);
        if (p.codigo_barras) setCodigoBarras(p.codigo_barras);
        setTimeout(() => refCantidad.current?.focus(), 50);
      });
  }, [productoEscaneado]);

  function elegirProducto(id: string) {
    const p = (productos ?? []).find((x) => x.id === id);
    if (!p) return;
    setDescripcion(p.nombre);
    setProductoId(p.id);
    if (p.unidad_medida) setUnidad(p.unidad_medida);
    if (p.codigo_barras && !codigoBarras) setCodigoBarras(p.codigo_barras);
    refCantidad.current?.focus();
  }

  // Lector de mano: escribe el código y manda Enter. Si es un producto
  // conocido de la empresa, llena descripción y unidad.
  function leerCodigoBarras(valor: string) {
    setCodigoBarras(valor);
    const p = (productos ?? []).find((x) => x.codigo_barras && x.codigo_barras === valor.trim());
    if (p) {
      setDescripcion(p.nombre);
      setProductoId(p.id);
      if (p.unidad_medida) setUnidad(p.unidad_medida);
    }
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!conteo) throw new Error("No hay un conteo abierto.");
      if (conteo.estado !== "abierto") throw new Error("El conteo ya está cerrado.");
      const falta = revisarItem({ empresa_id: empresaId, descripcion, cantidad, unidad });
      if (falta) throw new Error(falta);
      const { data, error: err } = await supabase
        .from("conteo_items")
        .insert({
          conteo_id: conteo.id,
          empresa_id: empresaId,
          descripcion: descripcion.trim(),
          cantidad: Number(cantidad.replace(/,/g, "")),
          unidad: unidad.trim(),
          ubicacion: ubicacion.trim() || null,
          codigo_barras: codigoBarras.trim() || null,
          notas: notas.trim() || null,
          producto_id: productoId,
          contado_por: perfil!.id,
        })
        .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, codigo_barras, notas, contado_por, contado_por_nombre, created_at")
        .single();
      if (err) throw err;
      return { ...(data as ItemConteo), cantidad: Number((data as ItemConteo).cantidad) };
    },
    onSuccess: (item) => {
      setError(null);
      setUltimo(item);
      setDescripcion("");
      setCantidad("");
      setCodigoBarras("");
      setNotas("");
      setProductoId(null);
      try {
        localStorage.setItem(UBICACION_KEY, ubicacion);
      } catch {
        /* sin almacenamiento local */
      }
      qc.invalidateQueries({ queryKey: ["conteo-items", conteo?.id] });
      refDescripcion.current?.focus();
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!guardar.isPending) guardar.mutate();
  }

  const corregir = useMutation({
    mutationFn: async ({ id, cantidad: c }: { id: string; cantidad: number }) => {
      const { error: err } = await supabase.from("conteo_items").update({ cantidad: c }).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conteo-items", conteo?.id] }),
    onError: (e: Error) => setError(e.message),
  });
  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from("conteo_items").delete().eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conteo-items", conteo?.id] }),
    onError: (e: Error) => setError(e.message),
  });

  // ── Administración del conteo ────────────────────────────────────────
  const [nombreNuevo, setNombreNuevo] = useState("Conteo de inventario");
  const [instruccionesNuevas, setInstruccionesNuevas] = useState("");
  const [avisoEnviado, setAvisoEnviado] = useState<string | null>(null);
  const abrir = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("conteos_inventario").insert({ fecha: hoy, nombre: nombreNuevo.trim() || "Conteo de inventario", instrucciones: instruccionesNuevas.trim() || null, estado: "abierto" });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["conteo-inventario-actual"] });
      qc.invalidateQueries({ queryKey: ["conteo-abierto-hoy"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const cambiarEstado = useMutation({
    mutationFn: async (estado: "abierto" | "cerrado") => {
      const { error: err } = await supabase.from("conteos_inventario").update({ estado }).eq("id", conteo!.id);
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conteo-inventario-actual"] });
      qc.invalidateQueries({ queryKey: ["conteo-abierto-hoy"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const avisar = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase.rpc("fn_conteo_avisar", { p_conteo_id: conteo!.id });
      if (err) throw err;
      return Number(data ?? 0);
    },
    onSuccess: (n) => setAvisoEnviado(`Aviso enviado a ${n} persona(s) de la organización (les llega a quienes tienen notificaciones activas).`),
    onError: (e: Error) => setError(e.message),
  });

  // ── Listas, filtros, etiquetas y Excel ───────────────────────────────
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroPersona, setFiltroPersona] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const todos = items ?? [];
  const mios = useMemo(() => todos.filter((i) => i.contado_por === perfil?.id), [todos, perfil?.id]);
  const filtrados = useMemo(() => filtrarItems(todos, { empresa: filtroEmpresa || undefined, persona: filtroPersona || undefined, texto: filtroTexto }), [todos, filtroEmpresa, filtroPersona, filtroTexto]);
  const resumen = useMemo(() => resumenConteo(todos, nombreEmpresa), [todos, nombreEmpresa]);
  const personas = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of todos) m.set(i.contado_por, i.contado_por_nombre ?? "(sin nombre)");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [todos]);
  const escaneado = itemEscaneado ? todos.find((i) => i.codigo === itemEscaneado) : undefined;

  async function imprimirHoja(armar: (qr: (texto: string) => Promise<string>) => Promise<EtiquetaConteo[]>, titulo: string) {
    const ventana = abrirVentanaImpresion();
    try {
      const Q = await import("qrcode");
      const qr = (texto: string) => Q.toString(texto, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
      const etiquetas = await armar(qr);
      if (!abrirParaImprimir(htmlEtiquetas(etiquetas, titulo), ventana)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    } catch (e) {
      ventana?.close();
      setError((e as Error).message);
    }
  }

  /** Etiquetas de ítems contados (con cantidad y ubicación). */
  function imprimirEtiquetas(lista: ItemConteo[], titulo: string) {
    if (!lista.length) return;
    return imprimirHoja(
      (qr) =>
        Promise.all(
          lista.map(async (i) => ({
            codigo: i.codigo,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            unidad: i.unidad,
            ubicacion: i.ubicacion,
            empresa: nombreEmpresa.get(i.empresa_id) ?? "",
            qrSvg: await qr(urlEtiqueta(i.codigo, window.location.origin)),
          })),
        ),
      titulo,
    );
  }

  /** Etiquetas de artículos del catálogo: el QR abre la captura con el producto ya puesto. */
  function imprimirProductos(lista: Producto[], empresa: string, titulo: string) {
    if (!lista.length) return;
    return imprimirHoja(
      (qr) =>
        Promise.all(
          lista.map(async (p) => ({
            codigo: p.sku || p.codigo_barras || "ARTÍCULO",
            descripcion: p.nombre,
            cantidad: null,
            unidad: p.unidad_medida || "pza",
            ubicacion: null,
            empresa,
            qrSvg: await qr(urlEtiquetaProducto(p.id, window.location.origin)),
          })),
        ),
      titulo,
    );
  }

  // ── Artículos del catálogo para etiquetar ────────────────────────────
  const [empresaCatalogo, setEmpresaCatalogo] = useState("");
  const [buscarCatalogo, setBuscarCatalogo] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const empresaCat = empresaCatalogo || empresaId;
  const { data: catalogo } = useQuery({
    queryKey: ["productos-conteo", empresaCat],
    enabled: !!empresaCat,
    queryFn: async () => {
      const { data, error } = await supabase.from("productos").select("id, sku, nombre, unidad_medida, codigo_barras").eq("empresa_id", empresaCat).eq("activo", true).order("nombre").limit(1000);
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });
  const catalogoFiltrado = useMemo(() => filtrarProductos(catalogo ?? [], buscarCatalogo), [catalogo, buscarCatalogo]);
  const contadosPorProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of todos) if (i.producto_id) m.set(i.producto_id, (m.get(i.producto_id) ?? 0) + 1);
    return m;
  }, [todos]);
  function alternar(id: string) {
    setMarcados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function descargarExcel() {
    descargarCsv(nombreExcelConteo(conteo?.fecha ?? hoy), csvConteo(filtrados, nombreEmpresa));
  }

  if (!perfil || perfil.rol === "pendiente") return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Conteo de inventario</h1>
          {conteo ? (
            <p className="text-sm text-slate-600">
              {conteo.nombre} · {fechaLarga(conteo.fecha)} ·{" "}
              {conteo.estado === "abierto" ? <span className="font-medium text-emerald-700">abierto</span> : <span className="font-medium text-slate-500">cerrado</span>}
              {conteo.instrucciones && <span className="block text-slate-700">{conteo.instrucciones}</span>}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{cargandoConteo ? "Cargando…" : "No hay ningún conteo abierto."}</p>
          )}
        </div>
        {administra && conteo && (
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={() => avisar.mutate()} disabled={avisar.isPending} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              🔔 Avisar a todos por notificación
            </button>
            {conteo.estado === "abierto" ? (
              <button type="button" onClick={() => window.confirm("¿Cerrar el conteo? Ya nadie podrá capturar ítems.") && cambiarEstado.mutate("cerrado")} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50">
                Cerrar conteo
              </button>
            ) : (
              <button type="button" onClick={() => cambiarEstado.mutate("abierto")} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50">
                Reabrir conteo
              </button>
            )}
          </div>
        )}
      </div>

      {avisoEnviado && <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{avisoEnviado}</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {administra && (!conteo || (conteo.estado === "cerrado" && conteo.fecha !== hoy)) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            abrir.mutate();
          }}
          className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4 text-sm"
          data-sin-borrador
        >
          <div className="font-medium text-slate-800">Abrir el conteo de hoy ({fechaLarga(hoy)})</div>
          <label className="block">
            <span className="block text-xs text-slate-500">Nombre</span>
            <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="block min-w-[18rem] flex-1">
            <span className="block text-xs text-slate-500">Instrucciones para todos (opcional)</span>
            <input value={instruccionesNuevas} onChange={(e) => setInstruccionesNuevas(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1" placeholder="p. ej. cada quien cuenta lo que tiene a la vista en su área" />
          </label>
          <button type="submit" disabled={abrir.isPending} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            Abrir conteo
          </button>
        </form>
      )}

      {escaneado && (
        <div className="rounded border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <div className="text-xs uppercase tracking-wide text-sky-700">Ítem escaneado</div>
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <QrSvg texto={urlEtiqueta(escaneado.codigo, window.location.origin)} className="block h-16 w-16 [&>svg]:h-16 [&>svg]:w-16" />
            <div>
              <div className="font-mono font-semibold">{escaneado.codigo}</div>
              <div className="text-base">{escaneado.descripcion}</div>
              <div className="text-xs text-sky-800">
                {escaneado.cantidad} {escaneado.unidad} · {nombreEmpresa.get(escaneado.empresa_id)}
                {escaneado.ubicacion ? ` · ${escaneado.ubicacion}` : ""} · contó {escaneado.contado_por_nombre ?? "—"} a las {hora(escaneado.created_at)}
              </div>
            </div>
          </div>
        </div>
      )}
      {itemEscaneado && !escaneado && !cargandoItems && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No se encontró el ítem {itemEscaneado} en este conteo.</p>}

      {conteo?.estado === "abierto" && (
        <form onSubmit={onSubmit} className="rounded border border-slate-200 bg-white p-4" data-sin-borrador>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Agregar ítem que estás contando</h2>
          <div className="grid gap-3 md:grid-cols-6">
            <label className="block text-sm md:col-span-2">
              <span className="block text-xs text-slate-500">Empresa dueña del inventario</span>
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5">
                {(empresas ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="block text-xs text-slate-500">Ubicación (bodega, rack, obra…)</span>
              <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" placeholder="se recuerda para el siguiente" />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="block text-xs text-slate-500">Código de barras del artículo (lector o a mano)</span>
              <input
                value={codigoBarras}
                onChange={(e) => leerCodigoBarras(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (descripcion ? refCantidad : refDescripcion).current?.focus();
                  }
                }}
                className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                placeholder="opcional"
              />
            </label>
            <div className="block text-sm md:col-span-3">
              <span className="block text-xs text-slate-500">Qué es (descripción)</span>
              <CampoBuscador
                value={descripcion}
                onChange={(t) => {
                  setDescripcion(t);
                  setProductoId(null);
                }}
                opciones={opcionesProducto}
                onElegir={elegirProducto}
                placeholder="p. ej. Varilla 3/8 R42 12 m"
                inputRef={refDescripcion}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && descripcion.trim()) {
                    e.preventDefault();
                    refCantidad.current?.focus();
                  }
                }}
                enterKeyHint="next"
              />
            </div>
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">Cantidad</span>
              <input ref={refCantidad} value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" className="w-full rounded border border-slate-300 px-2 py-1.5 text-right" placeholder="0" />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">Unidad</span>
              <input value={unidad} onChange={(e) => setUnidad(e.target.value)} list="unidades-conteo" className="w-full rounded border border-slate-300 px-2 py-1.5" />
              <datalist id="unidades-conteo">
                {UNIDADES_CONTEO.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">Notas</span>
              <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" placeholder="opcional" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Guardar ítem
            </button>
            <span className="text-xs text-slate-500">Enter guarda. Cada ítem recibe su código y su etiqueta QR.</span>
            {ultimo && (
              <span className="flex items-center gap-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                <QrSvg texto={urlEtiqueta(ultimo.codigo, window.location.origin)} className="block h-8 w-8 [&>svg]:h-8 [&>svg]:w-8" />
                Guardado <span className="font-mono font-semibold">{ultimo.codigo}</span> · {ultimo.descripcion} · {ultimo.cantidad} {ultimo.unidad}
                <button type="button" onClick={() => imprimirEtiquetas([ultimo], `Etiqueta ${ultimo.codigo}`)} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-emerald-800 hover:bg-emerald-100">
                  🖨 Imprimir esta etiqueta
                </button>
              </span>
            )}
          </div>
        </form>
      )}

      {conteo && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Etiquetas QR de los artículos del catálogo</h2>
              <p className="text-xs text-slate-500">Imprime el QR de los artículos que ya existen en el sistema y pégalo en su lugar. Al escanearlo, la captura queda llena con ese artículo y solo escribes la cantidad.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select value={empresaCat} onChange={(e) => { setEmpresaCatalogo(e.target.value); setMarcados(new Set()); }} className="rounded border border-slate-300 px-2 py-1">
                {(empresas ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
              <input value={buscarCatalogo} onChange={(e) => setBuscarCatalogo(e.target.value)} placeholder="buscar artículo o clave…" className="min-w-[12rem] rounded border border-slate-300 px-2 py-1" />
              <button
                type="button"
                onClick={() => imprimirProductos(catalogoFiltrado.filter((p) => marcados.has(p.id)), nombreEmpresa.get(empresaCat) ?? "", `Etiquetas QR · artículos · ${nombreEmpresa.get(empresaCat) ?? ""}`)}
                disabled={!catalogoFiltrado.some((p) => marcados.has(p.id))}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                🖨 Imprimir marcados ({catalogoFiltrado.filter((p) => marcados.has(p.id)).length})
              </button>
              <button
                type="button"
                onClick={() => imprimirProductos(catalogoFiltrado, nombreEmpresa.get(empresaCat) ?? "", `Etiquetas QR · artículos · ${nombreEmpresa.get(empresaCat) ?? ""}`)}
                disabled={!catalogoFiltrado.length}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                🖨 Imprimir todos los de la lista ({catalogoFiltrado.length})
              </button>
            </div>
          </div>
          {!catalogo?.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">Esta empresa no tiene artículos en el catálogo de inventario. Lo que cuenten se da de alta con su código INV- y su QR en la captura de arriba.</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={catalogoFiltrado.length > 0 && catalogoFiltrado.every((p) => marcados.has(p.id))}
                        onChange={(e) => setMarcados(e.target.checked ? new Set(catalogoFiltrado.map((p) => p.id)) : new Set())}
                        title="marcar todos los de la lista"
                      />
                    </th>
                    <th className="px-3 py-2">Clave</th>
                    <th className="px-3 py-2">Artículo</th>
                    <th className="px-3 py-2">Unidad</th>
                    <th className="px-3 py-2">Contado hoy</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {catalogoFiltrado.slice(0, 500).map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-3 py-1">
                        <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
                      </td>
                      <td className="px-3 py-1 font-mono text-xs">{p.sku ?? "—"}</td>
                      <td className="px-3 py-1">{p.nombre}</td>
                      <td className="px-3 py-1 text-slate-600">{p.unidad_medida ?? "—"}</td>
                      <td className="px-3 py-1 text-xs">{contadosPorProducto.get(p.id) ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{contadosPorProducto.get(p.id)} vez/veces</span> : <span className="text-slate-400">no</span>}</td>
                      <td className="px-3 py-1 text-right text-xs">
                        <button type="button" onClick={() => imprimirProductos([p], nombreEmpresa.get(empresaCat) ?? "", `Etiqueta ${p.sku ?? p.nombre}`)} className="text-slate-600 hover:underline">
                          🖨 QR
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {catalogoFiltrado.length > 500 && <p className="px-4 py-2 text-xs text-slate-500">Se muestran 500 de {catalogoFiltrado.length}; afina la búsqueda.</p>}
            </div>
          )}
        </section>
      )}

      {conteo && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Mis ítems ({mios.length})</h2>
            <button type="button" onClick={() => imprimirEtiquetas(mios, `Etiquetas QR · ${perfil.nombre} · ${conteo.fecha}`)} disabled={!mios.length} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              🖨 Imprimir mis etiquetas QR
            </button>
          </div>
          {mios.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Todavía no has capturado ítems en este conteo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">QR</th>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2">Empresa</th>
                    <th className="px-3 py-2">Ubicación</th>
                    <th className="px-3 py-2">Hora</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {mios.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <QrSvg texto={urlEtiqueta(i.codigo, window.location.origin)} className="block h-10 w-10 [&>svg]:h-10 [&>svg]:w-10" />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{i.codigo}</td>
                      <td className="px-3 py-1.5">
                        {i.descripcion}
                        {i.codigo_barras && <span className="block font-mono text-[10px] text-slate-400">{i.codigo_barras}</span>}
                        {i.notas && <span className="block text-xs text-slate-500">{i.notas}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {i.cantidad} {i.unidad}
                      </td>
                      <td className="px-3 py-1.5">{codigoEmpresa.get(i.empresa_id) ?? ""}</td>
                      <td className="px-3 py-1.5 text-slate-600">{i.ubicacion ?? "—"}</td>
                      <td className="px-3 py-1.5 text-slate-500">{hora(i.created_at)}</td>
                      <td className="px-3 py-1.5 text-right text-xs">
                        <button type="button" onClick={() => imprimirEtiquetas([i], `Etiqueta ${i.codigo}`)} className="mr-2 text-slate-600 hover:underline" title="Imprimir la etiqueta QR de este ítem">
                          🖨 QR
                        </button>
                        {conteo.estado === "abierto" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const v = window.prompt(`Cantidad de "${i.descripcion}" (${i.unidad}):`, String(i.cantidad));
                                if (v == null) return;
                                const n = Number(v.replace(/,/g, ""));
                                if (!Number.isFinite(n) || n < 0) return setError("La cantidad debe ser un número.");
                                corregir.mutate({ id: i.id, cantidad: n });
                              }}
                              className="text-slate-600 hover:underline"
                            >
                              corregir
                            </button>
                            <button type="button" onClick={() => window.confirm(`¿Borrar ${i.codigo} (${i.descripcion})?`) && borrar.mutate(i.id)} className="ml-2 text-red-600 hover:underline">
                              borrar
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {conteo && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Avance de todos: quién contó qué y de qué empresa</h2>
          </div>
          {resumen.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Nadie ha capturado todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Persona</th>
                    <th className="px-3 py-2">Empresa</th>
                    <th className="px-3 py-2 text-right">Ítems</th>
                    <th className="px-3 py-2 text-right">Cantidad total</th>
                    <th className="px-3 py-2">Primero</th>
                    <th className="px-3 py-2">Último</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((r) => (
                    <tr key={`${r.contado_por}-${r.empresa_id}`} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <button type="button" onClick={() => setFiltroPersona(r.contado_por)} className="hover:underline">
                          {r.persona}
                        </button>
                      </td>
                      <td className="px-3 py-1.5">{r.empresa}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.items}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.cantidad}</td>
                      <td className="px-3 py-1.5 text-slate-500">{hora(r.primero)}</td>
                      <td className="px-3 py-1.5 text-slate-500">{hora(r.ultimo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 text-sm font-semibold">
                  <tr>
                    <td className="px-3 py-2">{personas.length} persona(s)</td>
                    <td className="px-3 py-2">{new Set(todos.map((i) => i.empresa_id)).size} empresa(s)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{todos.length}</td>
                    <td className="px-3 py-2" colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-2 text-xs">
            <span className="font-medium text-slate-700">Todos los ítems</span>
            <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
              <option value="">Todas las empresas</option>
              {(empresas ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <select value={filtroPersona} onChange={(e) => setFiltroPersona(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
              <option value="">Todas las personas</option>
              {personas.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
            <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} placeholder="buscar código, descripción, ubicación…" className="min-w-[14rem] rounded border border-slate-300 px-2 py-1" />
            <span className="text-slate-500">
              {filtrados.length} de {todos.length}
            </span>
            <button type="button" onClick={descargarExcel} disabled={!filtrados.length} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Descargar Excel
            </button>
            <button type="button" onClick={() => imprimirEtiquetas(filtrados, `Etiquetas QR · ${conteo.fecha}`)} disabled={!filtrados.length} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              🖨 Etiquetas QR de estos {filtrados.length}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2">Contó</th>
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, 500).map((i) => (
                  <tr key={i.id} className={`border-t border-slate-100 ${escaneado?.id === i.id ? "bg-sky-50" : ""}`}>
                    <td className="px-3 py-1.5 font-mono text-xs">{i.codigo}</td>
                    <td className="px-3 py-1.5">{i.descripcion}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {i.cantidad} {i.unidad}
                    </td>
                    <td className="px-3 py-1.5">{nombreEmpresa.get(i.empresa_id) ?? ""}</td>
                    <td className="px-3 py-1.5 text-slate-600">{i.ubicacion ?? "—"}</td>
                    <td className="px-3 py-1.5">{i.contado_por_nombre ?? "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500">{hora(i.created_at)}</td>
                    <td className="px-3 py-1.5 text-right text-xs">
                      <button type="button" onClick={() => imprimirEtiquetas([i], `Etiqueta ${i.codigo}`)} className="text-slate-600 hover:underline" title="Imprimir la etiqueta QR de este ítem">
                        🖨 QR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrados.length > 500 && <p className="px-4 py-2 text-xs text-slate-500">Se muestran 500 de {filtrados.length}; el Excel trae todos.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
