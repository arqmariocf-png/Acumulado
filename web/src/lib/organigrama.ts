import { SECCIONES, type EntradaMenu, type SeccionMenu } from "./menu";

/** Organigrama por áreas de la dirección general (Mario, 25-sep-2026). Es
 * la primera pantalla del admin y las áreas van en la barra antes de
 * "Módulos". Cada área agrupa módulos ya existentes (se toman del catálogo
 * de lib/menu.ts por ruta, para no duplicar textos). */
export interface AreaOrganigrama {
  clave: string;
  titulo: string;
  descripcion: string;
  /** Quién la lleva hoy; se muestra en la tarjeta. */
  responsable: string | null;
  color: string;
  rutas: string[];
}

export const AREAS: AreaOrganigrama[] = [
  { clave: "finanzas", titulo: "Finanzas", descripcion: "Saldos, pagos y préstamos entre empresas", responsable: "Laura Ortaza", color: "bg-emerald-600", rutas: ["/dashboard", "/finanzas/saldos", "/finanzas/pagos", "/saldos", "/prestamos-intercompania"] },
  { clave: "contabilidad", titulo: "Contabilidad", descripcion: "Conciliación bancaria, CFDI y datos fiscales", responsable: "Delia Farfán", color: "bg-teal-600", rutas: ["/movimientos", "/carga", "/pendientes", "/perfil-fiscal", "/reportes"] },
  { clave: "rh", titulo: "Recursos humanos", descripcion: "Personal, expedientes, nómina, checador y accesos", responsable: "Fernando Gómez / Eréndira Solís", color: "bg-violet-600", rutas: ["/rh", "/rh/mano-de-obra", "/rh/agenda-pagos", "/bbva/asistencia", "/checador", "/mis-documentos"] },
  { clave: "almacen", titulo: "Almacén", descripcion: "Entradas y salidas contra OC/OV, existencias", responsable: null, color: "bg-amber-600", rutas: ["/inventario"] },
  { clave: "logistica", titulo: "Logística", descripcion: "Remisiones, entregas, compras y match con órdenes", responsable: null, color: "bg-orange-600", rutas: ["/inventario/remisiones", "/inventario/match", "/requisiciones"] },
  { clave: "mantenimiento", titulo: "Mantenimiento", descripcion: "Cuadrilla BBVA: folios, equilibrio y control", responsable: "Christian Bonifacio", color: "bg-sky-600", rutas: ["/mantenimiento/bbva", "/bbva/folios", "/bbva/equilibrio"] },
  { clave: "operacion", titulo: "Operación", descripcion: "Obras, precios unitarios, tareas y plantas", responsable: null, color: "bg-slate-700", rutas: ["/proyectos", "/precios", "/tareas", "/produccion/clavicon", "/produccion/balken", "/produccion/carpinteria", "/clavicon"] },
  { clave: "sistemas", titulo: "Sistemas", descripcion: "Usuarios, roles, reglas y guía de uso", responsable: "Mario Contreras", color: "bg-zinc-700", rutas: ["/admin", "/guia"] },
];

const ENTRADAS_POR_RUTA = new Map<string, EntradaMenu>();
for (const s of SECCIONES) for (const e of s.entradas) ENTRADAS_POR_RUTA.set(e.ruta, e);

/** Entradas de menú de un área, con los textos del catálogo. Las rutas que
 * no están en el catálogo (subpantallas) llevan una etiqueta propia. */
const EXTRA: Record<string, { etiqueta: string; descripcion: string; uso: string }> = {
  "/inventario/remisiones": { etiqueta: "Remisiones de salida", descripcion: "entregas de almacén con QR", uso: "Consultar, reimprimir y confirmar entregas." },
  "/inventario/match": { etiqueta: "Match con OC/OV", descripcion: "avance de recepción y embarque por orden y partida", uso: "Qué falta por recibir o embarcar de cada orden." },
};

export function entradasDeArea(area: AreaOrganigrama): EntradaMenu[] {
  return area.rutas.map((r) => {
    const e = ENTRADAS_POR_RUTA.get(r);
    if (e) return e;
    const x = EXTRA[r];
    return { ruta: r, etiqueta: x?.etiqueta ?? r, descripcion: x?.descripcion ?? "", uso: x?.uso ?? "", visible: () => true };
  });
}

export function areaComoSeccion(area: AreaOrganigrama): SeccionMenu {
  return { clave: `area-${area.clave}`, titulo: area.titulo, proposito: area.descripcion, entradas: entradasDeArea(area) };
}

export function areaDeClave(clave: string | undefined): AreaOrganigrama | undefined {
  return AREAS.find((a) => a.clave === clave);
}
