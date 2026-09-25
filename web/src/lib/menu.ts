import { esRolBasico } from "./modulos";
import type { Profile } from "../types/database";

/** Catálogo único de módulos, por área, con orientación de uso. Lo consumen
 * el menú de arriba, el inicio (agrupado) y la guía de uso; la visibilidad
 * por rol vive aquí y en ningún otro lado. */
export interface EntradaMenu {
  ruta: string;
  etiqueta: string;
  /** Qué es, en una línea (se ve en el menú). */
  descripcion: string;
  /** Cuándo o para qué se usa (se ve en la guía y como tooltip). */
  uso: string;
  visible: (p: Profile) => boolean;
}

export interface SeccionMenu {
  clave: string;
  titulo: string;
  /** Para quién es la sección, en una línea. */
  proposito: string;
  entradas: EntradaMenu[];
}

const esAdmin = (p: Profile) => p.rol === "admin";
const esFinanzas = (p: Profile) => p.rol === "corporativo" || p.rol === "direccion" || esAdmin(p);
const bbva = (p: Profile) => !!p.bbva_mantenimiento;
const modulo = (clave: string) => (p: Profile) => esRolBasico(p.rol) && (p.modulos ?? []).includes(clave);
// Roles que ven los módulos financieros completos (misma regla que tenía el
// menú: todo mundo menos los roles acotados).
const veFinanzasCompleto = (p: Profile) =>
  !esRolBasico(p.rol) &&
  !["responsable", "almacen", "rh_documentos", "produccion", "supervisor_bbva", "pendiente"].includes(p.rol) &&
  !(p.rol === "responsable" && bbva(p));
const esBbvaAcotado = (p: Profile) => p.rol === "responsable" && bbva(p);
const veOperacion = (p: Profile) => (veFinanzasCompleto(p) || p.rol === "responsable" || p.rol === "almacen") && !esBbvaAcotado(p);

const veInventario = (p: Profile) => veOperacion(p) || modulo("inventario")(p);
const veProduccion = (p: Profile) => p.rol === "produccion" || esAdmin(p) || modulo("produccion")(p);

/** Las ocho áreas del organigrama de dirección general (25-sep-2026). El
 * menú, el inicio, la guía y el organigrama usan esta misma clasificación. */
export const SECCIONES: SeccionMenu[] = [
  {
    clave: "finanzas",
    titulo: "Finanzas",
    proposito: "Saldos, pagos y préstamos entre las 8 empresas.",
    entradas: [
      { ruta: "/dashboard", etiqueta: "Panel de indicadores", descripcion: "KPIs, carga por empresa y saldos", uso: "Vista general para dirección; de aquí salen los reportes de Clavicón y saldos.", visible: veFinanzasCompleto },
      { ruta: "/finanzas/saldos", etiqueta: "Saldos por empresa", descripcion: "inicio y cierre por empresa, sin detalle", uso: "El resumen rápido para finanzas antes de programar pagos.", visible: esFinanzas },
      { ruta: "/finanzas/pagos", etiqueta: "Programación de pagos", descripcion: "calendario de pagos por empresa", uso: "Para programar y dar seguimiento a los pagos de la semana.", visible: esFinanzas },
      { ruta: "/saldos", etiqueta: "Saldos diarios", descripcion: "corte por cuenta bancaria", uso: "Saldo de inicio y cierre de cada cuenta por día.", visible: esFinanzas },
      { ruta: "/prestamos-intercompania", etiqueta: "Préstamos entre empresas", descripcion: "movimientos intercompañía", uso: "Cuando una empresa del grupo le presta a otra: queda registrado de los dos lados.", visible: veFinanzasCompleto },
    ],
  },
  {
    clave: "contabilidad",
    titulo: "Contabilidad",
    proposito: "Conciliación bancaria, CFDI y datos fiscales.",
    entradas: [
      { ruta: "/movimientos", etiqueta: "Movimientos", descripcion: "movimientos bancarios conciliados contra CFDI", uso: "Para revisar lo ambiguo, duplicado o sin factura después de cargar un estado de cuenta.", visible: veFinanzasCompleto },
      { ruta: "/carga", etiqueta: "Carga de archivos", descripcion: "estados de cuenta, CFDI y catálogo OC/OV", uso: "Cada corte: sube el PDF del banco y el zip de CFDI; el catálogo OC/OV se trae del backoffice.", visible: veFinanzasCompleto },
      { ruta: "/pendientes", etiqueta: "Pendientes", descripcion: "concentrado por proveedor", uso: "Qué falta pagar o facturar, agrupado por proveedor.", visible: veFinanzasCompleto },
      { ruta: "/perfil-fiscal", etiqueta: "Perfil fiscal", descripcion: "datos fiscales y legales de cada empresa", uso: "Razón social, RFC, representante legal y domicilio que salen en contratos y documentos.", visible: veFinanzasCompleto },
      { ruta: "/reportes", etiqueta: "Reportes especiales", descripcion: "reportes a la medida", uso: "Consultas puntuales que no caben en las pantallas normales.", visible: veFinanzasCompleto },
    ],
  },
  {
    clave: "rh",
    titulo: "Recursos humanos",
    proposito: "Personal, expedientes, nómina, checador y accesos al sistema.",
    entradas: [
      { ruta: "/checador", etiqueta: "Checador", descripcion: "entrada, comida y salida con foto y ubicación", uso: "Cada día al llegar, al salir a comer y al terminar. Funciona sin señal y sincroniza después.", visible: () => true },
      { ruta: "/mis-documentos", etiqueta: "Mis documentos", descripcion: "contrato, aviso de privacidad y documentos por firmar", uso: "Cuando RH te pide firmar algo o quieres consultar tu contrato.", visible: () => true },
      { ruta: "/bbva/asistencia", etiqueta: "Asistencia del equipo", descripcion: "marcas del checador de tu gente", uso: "Para revisar quién llegó, a qué hora y desde dónde.", visible: (p) => p.rol === "supervisor" || p.rol === "directivo" || (bbva(p) && p.rol !== "rh") },
      { ruta: "/rh", etiqueta: "Recursos humanos", descripcion: "personal, expedientes, contrataciones, nómina, checador y accesos", uso: "Alta de personal, documentos, contrato, y desde Accesos se crea la cuenta cuando el expediente está completo.", visible: (p) => p.rol === "rh" || p.rol === "rh_documentos" || esAdmin(p) },
      { ruta: "/rh/mano-de-obra", etiqueta: "Mano de obra", descripcion: "nómina externa de las APIs de Grupo Loma", uso: "Costo de mano de obra por periodo y por obra.", visible: (p) => p.rol === "rh" || esAdmin(p) },
      { ruta: "/rh/agenda-pagos", etiqueta: "Agenda de pagos", descripcion: "calendario de pagos de nómina", uso: "Qué se paga cada semana y quincena.", visible: (p) => p.rol === "rh" || esAdmin(p) },
    ],
  },
  {
    clave: "almacen",
    titulo: "Almacén",
    proposito: "Entradas y salidas de almacén contra OC/OV, existencias y productos.",
    entradas: [
      { ruta: "/inventario", etiqueta: "Registrar movimiento", descripcion: "entradas y salidas contra las partidas de la OC/OV", uso: "Al recibir material: elige la OC, marca las partidas que llegaron y guarda; sale el comprobante con QR.", visible: veInventario },
      { ruta: "/inventario/existencias", etiqueta: "Existencias", descripcion: "lo que hay en cada almacén", uso: "Para consultar stock antes de pedir o de prometer entrega.", visible: veInventario },
      { ruta: "/inventario/productos", etiqueta: "Productos", descripcion: "catálogo de productos por empresa", uso: "Corregir nombres, unidades y códigos de barras.", visible: veInventario },
    ],
  },
  {
    clave: "logistica",
    titulo: "Logística",
    proposito: "Remisiones, entregas, compras y match con las órdenes.",
    entradas: [
      { ruta: "/inventario/remisiones", etiqueta: "Remisiones de salida", descripcion: "entregas de almacén con QR", uso: "Consultar, reimprimir y confirmar entregas escaneando el QR.", visible: veInventario },
      { ruta: "/inventario/match", etiqueta: "Match con OC/OV", descripcion: "avance de recepción y embarque por orden y partida", uso: "Qué falta por recibir o embarcar de cada orden; lo que el proveedor aún debe.", visible: veInventario },
      { ruta: "/requisiciones", etiqueta: "Requisiciones", descripcion: "solicitudes de material por obra", uso: "El responsable pide; compras resuelve renglón por renglón.", visible: (p) => veOperacion(p) || modulo("requisiciones")(p) },
    ],
  },
  {
    clave: "mantenimiento",
    titulo: "Mantenimiento",
    proposito: "La cuadrilla de mantenimiento BBVA: folios, equilibrio y control.",
    entradas: [
      { ruta: "/mantenimiento/bbva", etiqueta: "Control BBVA", descripcion: "folios, estatus por paso y conciliación", uso: "Seguimiento de cada folio desde que se abre hasta que se cobra.", visible: (p) => esFinanzas(p) || bbva(p) },
      { ruta: "/bbva/folios", etiqueta: "Folios BBVA", descripcion: "semáforo de atención de las cuadrillas", uso: "Qué folios están por vencer o sin atender hoy.", visible: (p) => p.rol === "supervisor_bbva" || esFinanzas(p) || bbva(p) || modulo("bbva")(p) },
      { ruta: "/bbva/equilibrio", etiqueta: "Punto de equilibrio", descripcion: "gasto del equipo contra folios cobrados", uso: "Para saber si la operación BBVA se paga sola en el mes.", visible: (p) => esFinanzas(p) || p.rol === "rh" || bbva(p) },
    ],
  },
  {
    clave: "operacion",
    titulo: "Operación",
    proposito: "Obras, precios unitarios, tareas y las plantas de producción.",
    entradas: [
      { ruta: "/proyectos", etiqueta: "Proyectos", descripcion: "obras y proyectos con sus planos y avance", uso: "Para ver o registrar una obra, su responsable y sus archivos.", visible: (p) => veOperacion(p) || modulo("proyectos")(p) },
      { ruta: "/precios", etiqueta: "Precios unitarios", descripcion: "análisis de precio unitario y catálogo de insumos", uso: "Para cotizar: arma el análisis, almacén pone precios, dirección autoriza y se publica.", visible: (p) => veOperacion(p) || modulo("precios")(p) },
      { ruta: "/tareas", etiqueta: "Tareas", descripcion: "tableros de actividades y seguimiento", uso: "Para asignar y dar seguimiento a pendientes por equipo.", visible: (p) => veOperacion(p) || modulo("tareas")(p) },
      { ruta: "/produccion/clavicon", etiqueta: "Clavicón", descripcion: "mallas y clavos: lotes, órdenes y calendario de máquinas", uso: "Registra materia prima, programa la producción y genera remisiones al cliente.", visible: veProduccion },
      { ruta: "/produccion/balken", etiqueta: "Balken", descripcion: "vigueta y bovedilla, con despiece para cotizar", uso: "Cotiza losas por despiece y controla la producción.", visible: veProduccion },
      { ruta: "/produccion/carpinteria", etiqueta: "Carpintería", descripcion: "taller de carpintería", uso: "Órdenes de producción y remisiones del taller.", visible: veProduccion },
      { ruta: "/clavicon", etiqueta: "Panorama Clavicón", descripcion: "calendario de procesos y reporte oficial", uso: "Solo dirección: el estado completo de la planta en un documento.", visible: esAdmin },
    ],
  },
  {
    clave: "sistemas",
    titulo: "Sistemas",
    proposito: "Usuarios, roles, reglas del sistema y guía de uso.",
    entradas: [
      { ruta: "/admin", etiqueta: "Admin", descripcion: "usuarios, roles, cuentas, reglas y proyectos", uso: "Solo el administrador: dar rol a una cuenta, altas de cuentas bancarias y reglas del motor.", visible: esAdmin },
      { ruta: "/organigrama/configurar", etiqueta: "KPIs del organigrama", descripcion: "qué indicadores y umbrales lleva cada área", uso: "Solo dirección: elige los puntos de color de cada área del organigrama.", visible: esAdmin },
      { ruta: "/guia", etiqueta: "Guía de uso", descripcion: "qué hace cada módulo y cuándo usarlo", uso: "Cuando alguien nuevo entra al sistema o no sabe a dónde ir.", visible: () => true },
    ],
  },
];

/** Secciones con solo las entradas visibles para este perfil; las
 * secciones vacías se omiten. Un perfil 'pendiente' no ve nada. */
export function seccionesPara(perfil: Profile | null | undefined): SeccionMenu[] {
  if (!perfil || perfil.rol === "pendiente") return [];
  return SECCIONES.map((s) => ({ ...s, entradas: s.entradas.filter((e) => e.visible(perfil)) })).filter((s) => s.entradas.length > 0);
}

export function seccionDeRuta(ruta: string): SeccionMenu | undefined {
  return SECCIONES.find((s) => s.entradas.some((e) => ruta === e.ruta || ruta.startsWith(`${e.ruta}/`)));
}
