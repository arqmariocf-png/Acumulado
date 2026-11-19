import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { CampoBuscador, type OpcionBuscador } from "../../components/CampoBuscador";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { descargarCsv } from "../../lib/descargarArchivo";
import {
  administraConteo, claveArticulo, csvConteo, fechaHoyMx, filtrarItems, filtrarProductos, htmlEtiquetas, nombreExcelConteo, resumenConteo, revisarHerramientaNueva, revisarItem, UNIDADES_CONTEO, urlEtiqueta, urlEtiquetaHerramienta, urlEtiquetaProducto,
  type ConteoInventario as Conteo, type EtiquetaConteo, type ItemConteo,
} from "../../lib/conteoInventario";
import { RacksNiveles, useUbicaciones } from "./RacksNiveles";
import { ItemsComprasConteo } from "./ItemsComprasConteo";
import { useItemsCompra } from "../compras/useItemsCompra";
import { cruzarItemsConProductos, itemsContables } from "../../lib/itemsConteo";
import { lugaresParaContar, nombreUbicacion } from "../../lib/ubicacionesBodega";

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
  clave_control?: string | null;
  nombre: string;
  unidad_medida: string | null;
  codigo_barras: string | null;
}

interface HerramientaNueva {
  herramienta_id: string;
  folio: string;
  item_id: string;
  item_codigo: string;
  nombre: string;
  empresa: string;
  ubicacion: string | null;
}

interface TarjetaHerramienta {
  id: string;
  folio: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  estado: string;
  condicion: string | null;
  empresa_id: string;
  empresa: string;
  responsable_nombre: string | null;
  proyecto_id: string | null;
  obra: string | null;
  devolver_el: string | null;
  ultimo_conteo_codigo: string | null;
  ultimo_conteo_ubicacion: string | null;
  ultimo_conteo_en: string | null;
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
  const lugarEscaneado = params.get("lugar");
  const herramientaEscaneada = params.get("herramienta");
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
          .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, ubicacion_id, codigo_barras, notas, producto_id, herramienta_id, contado_por, contado_por_nombre, created_at")
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
  const [ubicacionId, setUbicacionId] = useState<string>(() => {
    try {
      return localStorage.getItem(UBICACION_KEY + "-id") ?? "";
    } catch {
      return "";
    }
  });
  const [codigoBarras, setCodigoBarras] = useState("");
  const [notas, setNotas] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  // Alta de ítems y herramientas con QR de control (19-nov-2026, Mario):
  // "material" cuenta (y, si se pide, da de alta el artículo en el catálogo
  // con clave ART-); "herramienta" da de alta cada pieza en Herramienta y
  // equipo (folio HE-) y la deja contada.
  const [tipo, setTipo] = useState<"material" | "herramienta">("material");
  const [darAlta, setDarAlta] = useState(false);
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [ultimoProducto, setUltimoProducto] = useState<(Producto & { empresa_id: string }) | null>(null);
  const [ultimasHerramientas, setUltimasHerramientas] = useState<HerramientaNueva[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<ItemConteo | null>(null);
  // Reajustar cantidades (19-nov-2026, Mario: "por si encuentran posteriormente
  // algo"): si el artículo ya lo contó la misma persona en este conteo, lo nuevo
  // se puede sumar a ese renglón en vez de abrir otro.
  const [sumarA, setSumarA] = useState(true);
  const [ajuste, setAjuste] = useState("");
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
      const { data, error } = await supabase.from("productos").select("id, sku, clave_control, nombre, unidad_medida, codigo_barras").eq("empresa_id", empresaId).eq("activo", true).order("nombre").limit(1000);
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });
  // También los items del catálogo de compras (8,263 del backoffice) que aún
  // no son artículo de la empresa: al elegir uno se da de alta con su clave
  // ART- al guardar (19-nov-2026, Laura: "tenemos más de 4 mil ítems").
  const { data: itemsCompra } = useItemsCompra(true);
  const itemsSinProducto = useMemo(() => cruzarItemsConProductos(itemsContables(itemsCompra ?? []), productos ?? []).filter((x) => !x.producto).map((x) => x.item), [itemsCompra, productos]);
  const opcionesProducto: OpcionBuscador[] = useMemo(
    () => [
      ...(productos ?? []).map((p) => ({ clave: p.id, titulo: p.nombre, detalle: [p.clave_control, p.unidad_medida, p.codigo_barras].filter(Boolean).join(" · ") || undefined })),
      ...itemsSinProducto.map((i) => ({ clave: `item:${i.id}`, titulo: i.descripcion, detalle: [i.clave, i.unidad, "catálogo de compras · se da de alta al guardar"].filter(Boolean).join(" · ") })),
    ],
    [productos, itemsSinProducto],
  );

  // QR de un artículo del catálogo: llena la captura con ese producto y deja
  // el cursor en la cantidad (una sola vez por carga).
  const productoPrellenado = useRef<string | null>(null);
  useEffect(() => {
    if (!productoEscaneado || productoPrellenado.current === productoEscaneado) return;
    productoPrellenado.current = productoEscaneado;
    supabase
      .rpc("fn_producto_etiqueta", { p_id: productoEscaneado })
      .maybeSingle()
      .then(({ data }) => {
        const p = data as (Producto & { empresa_id: string }) | null;
        if (!p) return setError("No se encontró ese artículo del catálogo.");
        setTipo("material");
        setEmpresaId(p.empresa_id);
        setDescripcion(p.nombre);
        setProductoId(p.id);
        if (p.unidad_medida) setUnidad(p.unidad_medida);
        if (p.codigo_barras) setCodigoBarras(p.codigo_barras);
        setTimeout(() => refCantidad.current?.focus(), 50);
      });
  }, [productoEscaneado]);

  // QR de control de una herramienta: su tarjeta (qué es, quién la tiene, dónde se contó).
  const { data: tarjetaHerramienta, isLoading: cargandoTarjeta } = useQuery({
    queryKey: ["herramienta-tarjeta", herramientaEscaneada],
    enabled: !!herramientaEscaneada,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_herramienta_tarjeta", { p_folio: herramientaEscaneada! }).maybeSingle();
      if (error) throw error;
      return (data ?? null) as TarjetaHerramienta | null;
    },
  });

  // Racks y niveles de la empresa elegida: el selector de lugar de la captura.
  const { data: ubicacionesEmpresa } = useUbicaciones(empresaId);
  const lugares = useMemo(() => lugaresParaContar(ubicacionesEmpresa ?? []), [ubicacionesEmpresa]);
  const nombreLugar = useMemo(() => new Map((ubicacionesEmpresa ?? []).map((u) => [u.id, u])), [ubicacionesEmpresa]);
  useEffect(() => {
    // Si el lugar guardado no es de esta empresa (o ya no existe), se limpia.
    if (ubicacionId && ubicacionesEmpresa && !ubicacionesEmpresa.some((u) => u.id === ubicacionId && u.activo)) setUbicacionId("");
  }, [ubicacionId, ubicacionesEmpresa]);

  // QR pegado en el rack: deja ese lugar elegido (y su empresa) y el cursor en la descripción.
  const lugarPrellenado = useRef<string | null>(null);
  useEffect(() => {
    if (!lugarEscaneado || lugarPrellenado.current === lugarEscaneado) return;
    lugarPrellenado.current = lugarEscaneado;
    supabase
      .from("inventario_ubicaciones")
      .select("id, empresa_id, codigo, activo")
      .eq("codigo", lugarEscaneado)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const u = data as { id: string; empresa_id: string; codigo: string; activo: boolean } | null;
        if (!u) return setError(`No se encontró el lugar ${lugarEscaneado}.`);
        setEmpresaId(u.empresa_id);
        setUbicacionId(u.id);
        setUbicacion(u.codigo);
        setTimeout(() => refDescripcion.current?.focus(), 50);
      });
  }, [lugarEscaneado]);

  function elegirProducto(id: string) {
    if (id.startsWith("item:")) {
      const it = itemsSinProducto.find((x) => x.id === id.slice(5));
      if (!it) return;
      setDescripcion(it.descripcion);
      setProductoId(null);
      if (it.unidad) setUnidad(it.unidad);
      setDarAlta(true);
      refCantidad.current?.focus();
      return;
    }
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
      if (tipo === "herramienta") {
        const faltaH = revisarHerramientaNueva({ empresa_id: empresaId, nombre: descripcion, piezas: cantidad });
        if (faltaH) throw new Error(faltaH);
        const { data: filas, error: errH } = await supabase.rpc("fn_conteo_alta_herramienta", {
          p_conteo_id: conteo.id,
          p_empresa_id: empresaId,
          p_nombre: descripcion.trim(),
          p_cantidad: Number(cantidad.trim() || "1"),
          p_marca: marca.trim() || null,
          p_modelo: modelo.trim() || null,
          p_notas: notas.trim() || null,
          p_ubicacion_id: ubicacionId || null,
          p_ubicacion: ubicacionId ? null : ubicacion.trim() || null,
        });
        if (errH) throw errH;
        const nuevas: HerramientaNueva[] = ((filas ?? []) as { herramienta_id: string; folio: string; item_id: string; item_codigo: string }[]).map((f) => ({
          ...f,
          nombre: [descripcion.trim(), marca.trim(), modelo.trim()].filter(Boolean).join(" "),
          empresa: nombreEmpresa.get(empresaId) ?? "",
          ubicacion: ubicacionId ? (nombreLugar.get(ubicacionId)?.codigo ?? null) : ubicacion.trim() || null,
        }));
        return { herramientas: nuevas };
      }
      const falta = revisarItem({ empresa_id: empresaId, descripcion, cantidad, unidad });
      if (falta) throw new Error(falta);
      if (yaContado && sumarA) {
        const nueva = Math.round((Number(yaContado.cantidad) + Number(cantidad.replace(/,/g, ""))) * 1000) / 1000;
        const { data: act, error: errS } = await supabase
          .from("conteo_items")
          .update({ cantidad: nueva, notas: [yaContado.notas, notas.trim() ? notas.trim() : null, `+${cantidad.trim()} ${hora(new Date().toISOString())}`].filter(Boolean).join(" · ") })
          .eq("id", yaContado.id)
          .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, ubicacion_id, codigo_barras, notas, producto_id, herramienta_id, contado_por, contado_por_nombre, created_at")
          .single();
        if (errS) throw errS;
        return { item: { ...(act as ItemConteo), cantidad: Number((act as ItemConteo).cantidad) }, productoNuevo: null, sumado: true };
      }
      let producto = productoId;
      let productoNuevo: (Producto & { empresa_id: string }) | null = null;
      if (!producto && darAlta) {
        const { data: idNuevo, error: errP } = await supabase.rpc("fn_conteo_alta_producto", {
          p_empresa_id: empresaId,
          p_nombre: descripcion.trim(),
          p_unidad: unidad.trim() || "pza",
          p_codigo_barras: codigoBarras.trim() || null,
        });
        if (errP) throw errP;
        producto = idNuevo as string;
        const { data: et } = await supabase.rpc("fn_producto_etiqueta", { p_id: producto }).maybeSingle();
        productoNuevo = (et ?? null) as (Producto & { empresa_id: string }) | null;
      }
      const { data, error: err } = await supabase
        .from("conteo_items")
        .insert({
          conteo_id: conteo.id,
          empresa_id: empresaId,
          descripcion: descripcion.trim(),
          cantidad: Number(cantidad.replace(/,/g, "")),
          unidad: unidad.trim(),
          ubicacion: ubicacionId ? null : ubicacion.trim() || null,
          ubicacion_id: ubicacionId || null,
          codigo_barras: codigoBarras.trim() || null,
          notas: notas.trim() || null,
          producto_id: producto,
          contado_por: perfil!.id,
        })
        .select("id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, ubicacion_id, codigo_barras, notas, producto_id, herramienta_id, contado_por, contado_por_nombre, created_at")
        .single();
      if (err) throw err;
      return { item: { ...(data as ItemConteo), cantidad: Number((data as ItemConteo).cantidad) }, productoNuevo, sumado: false };
    },
    onSuccess: (r) => {
      setError(null);
      setAviso(null);
      if (r.herramientas) {
        setUltimasHerramientas(r.herramientas);
        setUltimo(null);
        setUltimoProducto(null);
      } else {
        setUltimo(r.item);
        setUltimasHerramientas([]);
        setUltimoProducto(r.productoNuevo);
        if (r.productoNuevo) qc.invalidateQueries({ queryKey: ["productos-conteo"] });
      }
      setDescripcion("");
      setCantidad("");
      setCodigoBarras("");
      setNotas("");
      setMarca("");
      setModelo("");
      setDarAlta(false);
      setProductoId(null);
      try {
        localStorage.setItem(UBICACION_KEY, ubicacion);
        localStorage.setItem(UBICACION_KEY + "-id", ubicacionId);
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
    mutationFn: async ({ id, cantidad: c, nota }: { id: string; cantidad: number; nota?: string }) => {
      const previo = todos.find((i) => i.id === id);
      const notas = nota ? [previo?.notas, nota].filter(Boolean).join(" · ") : undefined;
      const { error: err } = await supabase.from("conteo_items").update(notas === undefined ? { cantidad: c } : { cantidad: c, notas }).eq("id", id);
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
  // Material ↔ herramienta sin borrar ni volver a capturar (19-nov-2026, Mario: "ya metí casi todo en Material").
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const cambiarTipo = useMutation({
    mutationFn: async ({ ids, a }: { ids: string[]; a: "herramienta" | "material" }) => {
      const { data, error: err } = await supabase.rpc(a === "herramienta" ? "fn_conteo_items_a_herramienta" : "fn_conteo_items_a_material", { p_ids: ids });
      if (err) throw err;
      return { a, n: ((data ?? []) as unknown[]).length };
    },
    onSuccess: ({ a, n }) => {
      setError(null);
      setSeleccion(new Set());
      setAviso(a === "herramienta" ? `${n} pieza(s) ahora son herramienta o equipo, cada una con su folio HE- y su QR de control.` : `${n} renglón(es) regresaron a material.`);
      qc.invalidateQueries({ queryKey: ["conteo-items", conteo?.id] });
    },
    onError: (e: Error) => setError(e.message),
  });
  function pasarAHerramienta(items: ItemConteo[]) {
    const lista = items.filter((i) => !i.herramienta_id);
    if (!lista.length) return;
    const piezas = lista.reduce((s, i) => s + Math.max(1, Math.round(Number(i.cantidad))), 0);
    if (!window.confirm(`¿Pasar ${lista.length} ítem(s) de material a herramienta o equipo? Se dan de alta ${piezas} pieza(s) con folio HE- (una por renglón; si un ítem tenía varias piezas, se abren renglones nuevos con la misma persona y lugar). Se puede regresar a material mientras no se asignen.`)) return;
    cambiarTipo.mutate({ ids: lista.map((i) => i.id), a: "herramienta" });
  }
  function regresarAMaterial(items: ItemConteo[]) {
    const lista = items.filter((i) => !!i.herramienta_id);
    if (!lista.length) return;
    if (!window.confirm(`¿Regresar ${lista.length} renglón(es) a material? Su herramienta HE- se da de baja (solo si nunca se asignó ni movió).`)) return;
    cambiarTipo.mutate({ ids: lista.map((i) => i.id), a: "material" });
  }

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
  const yaContado = useMemo(() => (tipo === "material" && productoId ? mios.find((i) => i.producto_id === productoId) ?? null : null), [tipo, productoId, mios]);
  const puedeAjustar = (i: ItemConteo) => administra || i.contado_por === perfil?.id;

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

  /** Etiquetas de ítems contados (con cantidad y ubicación); una herramienta sale con su QR de control (folio HE-). */
  function imprimirEtiquetas(lista: ItemConteo[], titulo: string) {
    if (!lista.length) return;
    return imprimirHoja(
      (qr) =>
        Promise.all(
          lista.map(async (i) =>
            i.herramienta_id && i.codigo_barras
              ? {
                  codigo: i.codigo_barras,
                  descripcion: i.descripcion,
                  cantidad: null,
                  unidad: "herramienta",
                  ubicacion: i.ubicacion,
                  empresa: nombreEmpresa.get(i.empresa_id) ?? "",
                  qrSvg: await qr(urlEtiquetaHerramienta(i.codigo_barras, window.location.origin)),
                }
              : {
                  codigo: i.codigo,
                  descripcion: i.descripcion,
                  cantidad: i.cantidad,
                  unidad: i.unidad,
                  ubicacion: i.ubicacion,
                  empresa: nombreEmpresa.get(i.empresa_id) ?? "",
                  qrSvg: await qr(urlEtiqueta(i.codigo, window.location.origin)),
                },
          ),
        ),
      titulo,
    );
  }

  /** Etiquetas QR de control de herramientas recién dadas de alta (folio HE-). */
  function imprimirHerramientas(lista: HerramientaNueva[], titulo: string) {
    if (!lista.length) return;
    return imprimirHoja(
      (qr) =>
        Promise.all(
          lista.map(async (h) => ({
            codigo: h.folio,
            descripcion: h.nombre,
            cantidad: null,
            unidad: "herramienta",
            ubicacion: h.ubicacion,
            empresa: h.empresa,
            qrSvg: await qr(urlEtiquetaHerramienta(h.folio, window.location.origin)),
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
            codigo: claveArticulo(p),
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
      const { data, error } = await supabase.from("productos").select("id, sku, clave_control, nombre, unidad_medida, codigo_barras").eq("empresa_id", empresaCat).eq("activo", true).order("nombre").limit(1000);
      if (error) throw error;
      return (data ?? []) as Producto[];
    },
  });
  const catalogoFiltrado = useMemo(() => filtrarProductos(catalogo ?? [], buscarCatalogo), [catalogo, buscarCatalogo]);
  // Claves nuevas para contar de cero (19-nov-2026, Laura: "la clave de las
  // etiquetas es errónea, las toma sobre cada OC registrada"): el sku del
  // match (OC-…) no sirve; la etiqueta lleva la clave de control ART-.
  const sinClave = useMemo(() => (catalogo ?? []).filter((p) => !p.clave_control).length, [catalogo]);
  const asignarClaves = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase.rpc("fn_productos_asignar_claves", { p_empresa_id: empresaCat });
      if (err) throw err;
      return data as number;
    },
    onSuccess: (n) => {
      setError(null);
      setAviso(`Se asignaron ${n} claves de control nuevas. Ya puedes imprimir las etiquetas.`);
      qc.invalidateQueries({ queryKey: ["productos-conteo"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const contadosPorLugar = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of todos) if (i.ubicacion_id) m.set(i.ubicacion_id, (m.get(i.ubicacion_id) ?? 0) + 1);
    return m;
  }, [todos]);
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
      {aviso && <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}

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
              {puedeAjustar(escaneado) && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                  data-sin-borrador
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(ajuste.replace(/,/g, ""));
                    if (!Number.isFinite(n) || n <= 0) return setError("Escribe cuántas piezas más encontraste.");
                    corregir.mutate({ id: escaneado.id, cantidad: Math.round((Number(escaneado.cantidad) + n) * 1000) / 1000, nota: `+${n} ${hora(new Date().toISOString())}` });
                    setAjuste("");
                  }}
                >
                  <span className="text-sky-800">¿Encontraste más después?</span>
                  <input value={ajuste} onChange={(e) => setAjuste(e.target.value)} inputMode="decimal" className="w-20 rounded border border-sky-300 px-2 py-1 text-right" placeholder="+ cuántas" />
                  <button type="submit" disabled={corregir.isPending} className="rounded bg-sky-700 px-2 py-1 font-medium text-white disabled:opacity-50">
                    Sumar a {escaneado.codigo}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const v = window.prompt(`Nueva cantidad total de ${escaneado.codigo} (${escaneado.descripcion}). Hoy: ${escaneado.cantidad} ${escaneado.unidad}`, String(escaneado.cantidad));
                      if (v == null) return;
                      const n = Number(v.replace(/,/g, ""));
                      if (!Number.isFinite(n) || n < 0) return setError("La cantidad debe ser un número (0 o más).");
                      corregir.mutate({ id: escaneado.id, cantidad: n, nota: `corregido de ${escaneado.cantidad} a ${n} ${hora(new Date().toISOString())}` });
                    }}
                    className="rounded border border-sky-300 bg-white px-2 py-1 text-sky-900 hover:bg-sky-100"
                  >
                    Corregir la cantidad total
                  </button>
                  {conteo?.estado === "abierto" &&
                    (escaneado.herramienta_id ? (
                      <button type="button" onClick={() => regresarAMaterial([escaneado])} disabled={cambiarTipo.isPending} className="rounded border border-sky-300 bg-white px-2 py-1 text-sky-900 hover:bg-sky-100 disabled:opacity-50">
                        Regresar a material
                      </button>
                    ) : (
                      <button type="button" onClick={() => pasarAHerramienta([escaneado])} disabled={cambiarTipo.isPending} className="rounded border border-violet-300 bg-white px-2 py-1 text-violet-900 hover:bg-violet-100 disabled:opacity-50">
                        🔧 Pasar a herramienta o equipo
                      </button>
                    ))}
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      {itemEscaneado && !escaneado && !cargandoItems && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No se encontró el ítem {itemEscaneado} en este conteo.</p>}

      {tarjetaHerramienta && (
        <div className="rounded border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
          <div className="text-xs uppercase tracking-wide text-violet-700">Herramienta o equipo · QR de control</div>
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <QrSvg texto={urlEtiquetaHerramienta(tarjetaHerramienta.folio, window.location.origin)} className="block h-16 w-16 [&>svg]:h-16 [&>svg]:w-16" />
            <div>
              <div className="font-mono font-semibold">{tarjetaHerramienta.folio}</div>
              <div className="text-base">{[tarjetaHerramienta.nombre, tarjetaHerramienta.marca, tarjetaHerramienta.modelo].filter(Boolean).join(" ")}</div>
              <div className="text-xs text-violet-900">
                {tarjetaHerramienta.empresa} · {tarjetaHerramienta.estado}
                {tarjetaHerramienta.condicion ? ` · condición ${tarjetaHerramienta.condicion}` : ""}
                {tarjetaHerramienta.responsable_nombre ? ` · a cargo de ${tarjetaHerramienta.responsable_nombre}` : " · sin responsable asignado"}
                {tarjetaHerramienta.obra ? ` · obra ${tarjetaHerramienta.obra}` : ""}
                {tarjetaHerramienta.devolver_el ? ` · regresa el ${tarjetaHerramienta.devolver_el}` : ""}
              </div>
              {tarjetaHerramienta.ultimo_conteo_codigo && (
                <div className="text-xs text-violet-900">
                  Último conteo: {tarjetaHerramienta.ultimo_conteo_codigo}
                  {tarjetaHerramienta.ultimo_conteo_ubicacion ? ` en ${tarjetaHerramienta.ultimo_conteo_ubicacion}` : ""}
                  {tarjetaHerramienta.ultimo_conteo_en ? ` (${hora(tarjetaHerramienta.ultimo_conteo_en)})` : ""}
                </div>
              )}
              <a href="/almacen/herramienta" className="text-xs text-violet-800 underline">
                Abrir Herramienta y equipo (asignar, regresar, reparar)
              </a>
            </div>
          </div>
        </div>
      )}
      {herramientaEscaneada && !tarjetaHerramienta && !cargandoTarjeta && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No se encontró la herramienta {herramientaEscaneada} en tu organización.</p>}

      {conteo?.estado === "abierto" && (
        <form onSubmit={onSubmit} className="rounded border border-slate-200 bg-white p-4" data-sin-borrador>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-800">{tipo === "material" ? "Agregar ítem que estás contando" : "Dar de alta herramienta o equipo (con QR de control)"}</h2>
            <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
              <button type="button" onClick={() => setTipo("material")} className={`px-3 py-1 ${tipo === "material" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
                Material / artículo
              </button>
              <button type="button" onClick={() => setTipo("herramienta")} className={`px-3 py-1 ${tipo === "herramienta" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
                🔧 Herramienta o equipo
              </button>
            </div>
          </div>
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
              <span className="block text-xs text-slate-500">{lugares.length ? "Lugar (rack · nivel) o ubicación a mano" : "Ubicación (bodega, rack, obra…)"}</span>
              {lugares.length > 0 && (
                <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)} className="mb-1 w-full rounded border border-slate-300 px-2 py-1.5">
                  <option value="">— escribir la ubicación a mano —</option>
                  {lugares.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.codigo} · {nombreUbicacion(u)}
                    </option>
                  ))}
                </select>
              )}
              {!ubicacionId && <input value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" placeholder="se recuerda para el siguiente" />}
              {ubicacionId && <span className="block text-xs text-emerald-700">Se guarda en {nombreLugar.get(ubicacionId)?.codigo}; se recuerda para el siguiente ítem.</span>}
            </label>
            {tipo === "herramienta" ? (
              <label className="block text-sm md:col-span-2">
                <span className="block text-xs text-slate-500">Marca / modelo (opcional)</span>
                <div className="flex gap-1">
                  <input value={marca} onChange={(e) => setMarca(e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5" placeholder="marca" />
                  <input value={modelo} onChange={(e) => setModelo(e.target.value)} className="w-1/2 rounded border border-slate-300 px-2 py-1.5" placeholder="modelo" />
                </div>
              </label>
            ) : (
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
            )}
            <div className="block text-sm md:col-span-3">
              <span className="block text-xs text-slate-500">{tipo === "herramienta" ? "Qué herramienta o equipo es" : "Qué es (descripción)"}</span>
              <CampoBuscador
                value={descripcion}
                onChange={(t) => {
                  setDescripcion(t);
                  setProductoId(null);
                }}
                opciones={tipo === "herramienta" ? [] : opcionesProducto}
                onElegir={elegirProducto}
                placeholder={tipo === "herramienta" ? "p. ej. Taladro inalámbrico 20 V" : "p. ej. Varilla 3/8 R42 12 m"}
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
              <span className="block text-xs text-slate-500">{tipo === "herramienta" ? "Piezas (un folio por pieza)" : "Cantidad"}</span>
              <input ref={refCantidad} value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode={tipo === "herramienta" ? "numeric" : "decimal"} className="w-full rounded border border-slate-300 px-2 py-1.5 text-right" placeholder={tipo === "herramienta" ? "1" : "0"} />
            </label>
            {tipo === "material" ? (
              <label className="block text-sm">
                <span className="block text-xs text-slate-500">Unidad</span>
                <input value={unidad} onChange={(e) => setUnidad(e.target.value)} list="unidades-conteo" className="w-full rounded border border-slate-300 px-2 py-1.5" />
                <datalist id="unidades-conteo">
                  {UNIDADES_CONTEO.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>
            ) : (
              <div className="block text-sm">
                <span className="block text-xs text-slate-500">Unidad</span>
                <span className="block rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">pza</span>
              </div>
            )}
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">Notas</span>
              <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5" placeholder="opcional" />
            </label>
          </div>
          {yaContado && (
            <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
              <input type="checkbox" checked={sumarA} onChange={(e) => setSumarA(e.target.checked)} />
              Ya contaste este artículo en <span className="font-mono">{yaContado.codigo}</span> ({yaContado.cantidad} {yaContado.unidad}
              {yaContado.ubicacion ? ` en ${yaContado.ubicacion}` : ""}): sumar esta cantidad a ese renglón en vez de abrir otro.
            </label>
          )}
          {tipo === "material" && descripcion.trim() && !productoId && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={darAlta} onChange={(e) => setDarAlta(e.target.checked)} />
              Este artículo no está en el catálogo: darlo de alta (recibe clave ART- y su QR de control para pegarlo en el producto)
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {tipo === "herramienta" ? "Dar de alta y contar" : "Guardar ítem"}
            </button>
            <span className="text-xs text-slate-500">
              {tipo === "herramienta" ? "Cada pieza recibe su folio HE- (Herramienta y equipo) y su QR de control, y queda contada en este conteo." : "Enter guarda. Cada ítem recibe su código y su etiqueta QR."}
            </span>
            {ultimasHerramientas.length > 0 && (
              <span className="flex flex-wrap items-center gap-2 rounded bg-violet-50 px-2 py-1 text-xs text-violet-900">
                <QrSvg texto={urlEtiquetaHerramienta(ultimasHerramientas[0].folio, window.location.origin)} className="block h-8 w-8 [&>svg]:h-8 [&>svg]:w-8" />
                {ultimasHerramientas.length === 1 ? "Dada de alta" : `${ultimasHerramientas.length} dadas de alta`}{" "}
                <span className="font-mono font-semibold">{ultimasHerramientas.length === 1 ? ultimasHerramientas[0].folio : `${ultimasHerramientas[0].folio} … ${ultimasHerramientas[ultimasHerramientas.length - 1].folio}`}</span> · {ultimasHerramientas[0].nombre}
                <button type="button" onClick={() => imprimirHerramientas(ultimasHerramientas, `QR de control · ${ultimasHerramientas[0].nombre}`)} className="rounded border border-violet-300 bg-white px-2 py-0.5 text-violet-900 hover:bg-violet-100">
                  🖨 Imprimir {ultimasHerramientas.length === 1 ? "la etiqueta" : `las ${ultimasHerramientas.length} etiquetas`} de control
                </button>
              </span>
            )}
            {ultimoProducto && (
              <span className="flex items-center gap-2 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900">
                Artículo nuevo en el catálogo <span className="font-mono font-semibold">{ultimoProducto.sku}</span>
                <button type="button" onClick={() => imprimirProductos([ultimoProducto], nombreEmpresa.get(ultimoProducto.empresa_id) ?? "", `Etiqueta ${ultimoProducto.sku}`)} className="rounded border border-sky-300 bg-white px-2 py-0.5 text-sky-900 hover:bg-sky-100">
                  🖨 QR de control del artículo
                </button>
              </span>
            )}
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

      {conteo && empresaId && <RacksNiveles empresaId={empresaId} empresaNombre={nombreEmpresa.get(empresaId) ?? ""} administra={administra} contadosPorLugar={contadosPorLugar} />}

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
              {administra && sinClave > 0 && (
                <button
                  type="button"
                  onClick={() => window.confirm(`¿Generar claves de control nuevas (ART-${codigoEmpresa.get(empresaCat) ?? ""}-0001…) para los ${sinClave} artículos que no la tienen? El sku del match de OC/OV no cambia.`) && asignarClaves.mutate()}
                  disabled={asignarClaves.isPending}
                  className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  Generar claves nuevas ({sinClave} sin clave)
                </button>
              )}
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
                      <td className="px-3 py-1 font-mono text-xs">{p.clave_control ?? <span className="text-amber-700" title="Clave del match de OC/OV, no sirve para contar: genera las claves nuevas">{p.sku ?? "—"} ⚠</span>}</td>
                      <td className="px-3 py-1">{p.nombre}</td>
                      <td className="px-3 py-1 text-slate-600">{p.unidad_medida ?? "—"}</td>
                      <td className="px-3 py-1 text-xs">{contadosPorProducto.get(p.id) ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{contadosPorProducto.get(p.id)} vez/veces</span> : <span className="text-slate-400">no</span>}</td>
                      <td className="px-3 py-1 text-right text-xs">
                        <button type="button" onClick={() => imprimirProductos([p], nombreEmpresa.get(empresaCat) ?? "", `Etiqueta ${claveArticulo(p)}`)} className="text-slate-600 hover:underline">
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

      {conteo && empresaCat && (
        <ItemsComprasConteo
          empresaId={empresaCat}
          empresaNombre={nombreEmpresa.get(empresaCat) ?? ""}
          productos={catalogo ?? []}
          imprimir={(lista, titulo) => imprimirProductos(lista as Producto[], nombreEmpresa.get(empresaCat) ?? "", titulo)}
          onError={setError}
          onAviso={setAviso}
        />
      )}

      {conteo && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Mis ítems ({mios.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              {conteo.estado === "abierto" && mios.some((i) => !i.herramienta_id) && (
                <button type="button" onClick={() => pasarAHerramienta(mios)} disabled={cambiarTipo.isPending} className="rounded border border-violet-300 bg-violet-50 px-3 py-1 text-xs text-violet-900 hover:bg-violet-100 disabled:opacity-50" title="Si capturaste herramienta o equipo como material, pásalo aquí sin borrar nada">
                  🔧 Pasar mis materiales a herramienta ({mios.filter((i) => !i.herramienta_id).length})
                </button>
              )}
              <button type="button" onClick={() => imprimirEtiquetas(mios, `Etiquetas QR · ${perfil.nombre} · ${conteo.fecha}`)} disabled={!mios.length} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                🖨 Imprimir mis etiquetas QR
              </button>
            </div>
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
                        {i.herramienta_id && <span className="mr-1 rounded bg-violet-100 px-1 text-[10px] text-violet-800" title="Herramienta o equipo (QR de control HE-)">🔧</span>}
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
                            {i.herramienta_id ? (
                              <button type="button" onClick={() => regresarAMaterial([i])} className="ml-2 text-slate-600 hover:underline" title="Regresar este renglón a material (la herramienta se da de baja)">
                                → material
                              </button>
                            ) : (
                              <button type="button" onClick={() => pasarAHerramienta([i])} className="ml-2 text-violet-700 hover:underline" title="Pasar a herramienta o equipo (folio HE- y QR de control)">
                                → herramienta
                              </button>
                            )}
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
            {conteo.estado === "abierto" && seleccion.size > 0 && (
              <>
                <span className="text-slate-700">{seleccion.size} marcado(s):</span>
                <button type="button" onClick={() => pasarAHerramienta(todos.filter((i) => seleccion.has(i.id)))} disabled={cambiarTipo.isPending || !todos.some((i) => seleccion.has(i.id) && !i.herramienta_id)} className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-violet-900 hover:bg-violet-100 disabled:opacity-50">
                  🔧 Pasar a herramienta o equipo
                </button>
                <button type="button" onClick={() => regresarAMaterial(todos.filter((i) => seleccion.has(i.id)))} disabled={cambiarTipo.isPending || !todos.some((i) => seleccion.has(i.id) && i.herramienta_id)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Regresar a material
                </button>
                <button type="button" onClick={() => setSeleccion(new Set())} className="text-slate-500 hover:underline">
                  quitar marcas
                </button>
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {conteo.estado === "abierto" && (
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        title="Marcar todos los que puedo cambiar"
                        checked={filtrados.some((i) => puedeAjustar(i)) && filtrados.filter((i) => puedeAjustar(i)).every((i) => seleccion.has(i.id))}
                        onChange={(e) => setSeleccion(e.target.checked ? new Set(filtrados.filter((i) => puedeAjustar(i)).map((i) => i.id)) : new Set())}
                      />
                    </th>
                  )}
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
                    {conteo.estado === "abierto" && (
                      <td className="px-2 py-1.5">
                        {puedeAjustar(i) && (
                          <input
                            type="checkbox"
                            checked={seleccion.has(i.id)}
                            onChange={(e) => {
                              const n = new Set(seleccion);
                              if (e.target.checked) n.add(i.id);
                              else n.delete(i.id);
                              setSeleccion(n);
                            }}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 font-mono text-xs">{i.codigo}</td>
                    <td className="px-3 py-1.5">
                      {i.herramienta_id && <span className="mr-1 rounded bg-violet-100 px-1 text-[10px] text-violet-800" title="Herramienta o equipo (QR de control HE-)">🔧</span>}
                      {i.descripcion}
                    </td>
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
                      {conteo.estado === "abierto" &&
                        puedeAjustar(i) &&
                        (i.herramienta_id ? (
                          <button type="button" onClick={() => regresarAMaterial([i])} className="ml-2 text-slate-600 hover:underline" title="Regresar a material">
                            → material
                          </button>
                        ) : (
                          <button type="button" onClick={() => pasarAHerramienta([i])} className="ml-2 text-violet-700 hover:underline" title="Pasar a herramienta o equipo (folio HE- y QR de control)">
                            → herramienta
                          </button>
                        ))}
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
