import { esRhDirectivo, esRolBasico } from "./modulos";
import type { ModuloClave, Profile } from "../types/database";

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
  /** El módulo de organización al que pertenece. Una organización cliente
   * solo ve las entradas cuyo módulo tiene abierto -- y las que no declaran
   * ninguno no las ve, que es el default seguro: un módulo sin interruptor
   * todavía no se le puede vender a nadie. La organización maestra ve todo. */
  modulo?: ModuloClave;
  /** Pantallas de la propia persona o de su cuenta (checador, sus documentos,
   * la guía, la administración de su organización): no dependen de módulos. */
  personal?: true;
  /** Submenú del encabezado (Mario, 26-sep-2026): niveles en vertical bajo
   * la entrada y, dentro de cada nivel, sus pestañas en horizontal (con un
   * tercer nivel también horizontal cuando aplica). Las rutas llevan
   * `?tab=`; para el catálogo y la guía sigue contando solo `ruta`. */
  niveles?: NivelMenu[];
}

export interface NivelMenu {
  etiqueta: string;
  ruta: string;
  visible?: (p: Profile) => boolean;
  hijos?: NivelMenu[];
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
      { ruta: "/dashboard", etiqueta: "Panel de indicadores", descripcion: "KPIs, carga por empresa y saldos", uso: "Vista general para dirección; de aquí salen los reportes de Clavicón y saldos.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/finanzas/saldos", etiqueta: "Saldos por empresa", descripcion: "inicio y cierre por empresa, sin detalle", uso: "El resumen rápido para finanzas antes de programar pagos.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/gastos", etiqueta: "Comprobación de gastos", descripcion: "caja chica y gastos de obra con factura o nota", uso: "El supervisor sube el comprobante con monto y obra; finanzas recibe el aviso y lo aprueba.", visible: (p) => ["supervisor", "responsable", "directivo", "administrativo", "corporativo", "direccion", "empresa", "admin"].includes(p.rol) , modulo: "conciliacion" },
      { ruta: "/finanzas/pagos", etiqueta: "Programación de pagos", descripcion: "calendario de pagos por empresa", uso: "Para programar y dar seguimiento a los pagos de la semana.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/saldos", etiqueta: "Saldos diarios", descripcion: "corte por cuenta bancaria", uso: "Saldo de inicio y cierre de cada cuenta por día.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/prestamos-intercompania", etiqueta: "Préstamos entre empresas", descripcion: "movimientos intercompañía", uso: "Cuando una empresa del grupo le presta a otra: queda registrado de los dos lados.", visible: veFinanzasCompleto , modulo: "conciliacion" },
    ],
  },
  {
    clave: "contabilidad",
    titulo: "Contabilidad",
    proposito: "Conciliación bancaria, CFDI y datos fiscales.",
    entradas: [
      { ruta: "/movimientos", etiqueta: "Movimientos", descripcion: "movimientos bancarios conciliados contra CFDI", uso: "Para revisar lo ambiguo, duplicado o sin factura después de cargar un estado de cuenta.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/carga", etiqueta: "Carga de archivos", descripcion: "estados de cuenta, CFDI y catálogo OC/OV", uso: "Cada corte: sube el PDF del banco y el zip de CFDI; el catálogo OC/OV se trae del backoffice.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/pendientes", etiqueta: "Pendientes", descripcion: "concentrado por proveedor", uso: "Qué falta pagar o facturar, agrupado por proveedor.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/perfil-fiscal", etiqueta: "Perfil fiscal", descripcion: "datos fiscales y legales de cada empresa", uso: "Razón social, RFC, representante legal y domicilio que salen en contratos y documentos.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/reportes", etiqueta: "Reportes especiales", descripcion: "reportes a la medida", uso: "Consultas puntuales que no caben en las pantallas normales.", visible: veFinanzasCompleto , modulo: "conciliacion" },
    ],
  },
  {
    clave: "rh",
    titulo: "Recursos humanos",
    proposito: "Personal, expedientes, nómina, checador y accesos al sistema.",
    entradas: [
      {
        ruta: "/rh",
        etiqueta: "Recursos humanos",
        descripcion: "indicadores, personal, operación, vacantes y accesos",
        uso: "Entra a los indicadores; de ahí el flujo de personal (contrato, expediente, alta), checador, asignaciones y accesos.",
        visible: (p) => p.rol === "rh" || p.rol === "rh_documentos" || esAdmin(p),
        modulo: "rh",
        niveles: [
          {
            etiqueta: "Indicadores",
            ruta: "/rh?tab=kpi_checador",
            visible: (p) => esRhDirectivo(p),
            hijos: [
              { etiqueta: "Asistencias y retardos", ruta: "/rh?tab=kpi_checador" },
              { etiqueta: "Vacantes y rotación", ruta: "/rh?tab=kpi_vacantes" },
              { etiqueta: "Cumplimiento de actividades", ruta: "/rh?tab=kpi_actividades" },
            ],
          },
          {
            etiqueta: "Personal",
            ruta: "/rh?tab=contrataciones",
            hijos: [
              { etiqueta: "1. Contrataciones", ruta: "/rh?tab=contrataciones", visible: (p) => p.rol !== "rh_documentos" },
              { etiqueta: "2. Documentos / Expediente", ruta: "/rh?tab=documentos" },
              { etiqueta: "3. Personal", ruta: "/rh?tab=personal", visible: (p) => p.rol !== "rh_documentos" },
            ],
          },
          {
            etiqueta: "Operación",
            ruta: "/rh?tab=checador",
            visible: (p) => p.rol !== "rh_documentos",
            hijos: [
              {
                etiqueta: "4. Checador",
                ruta: "/rh?tab=checador",
                hijos: [
                  { etiqueta: "Marcas", ruta: "/rh?tab=checador&sub=marcas" },
                  { etiqueta: "Sitios", ruta: "/rh?tab=checador&sub=sitios" },
                  { etiqueta: "Jornadas", ruta: "/rh?tab=checador&sub=jornadas" },
                ],
              },
              { etiqueta: "5. Asignaciones diarias", ruta: "/rh?tab=asignaciones" },
            ],
          },
          {
            etiqueta: "Vacantes y actividades",
            ruta: "/rh?tab=actividades",
            visible: (p) => p.rol !== "rh_documentos",
            hijos: [
              { etiqueta: "Vacantes", ruta: "/rh?tab=vacantes", visible: (p) => esRhDirectivo(p) },
              { etiqueta: "Actividades", ruta: "/rh?tab=actividades" },
            ],
          },
          { etiqueta: "Accesos al sistema", ruta: "/rh?tab=accesos", visible: (p) => esRhDirectivo(p) },
        ],
      },
      { ruta: "/rh/mano-de-obra", etiqueta: "Mano de obra", descripcion: "nómina externa de las APIs de Grupo Loma", uso: "Costo de mano de obra por periodo y por obra.", visible: (p) => p.rol === "rh" || esAdmin(p) , modulo: "rh" },
      { ruta: "/rh/agenda-pagos", etiqueta: "Agenda de pagos", descripcion: "calendario de pagos de nómina", uso: "Qué se paga cada semana y quincena.", visible: (p) => p.rol === "rh" || esAdmin(p) , modulo: "rh" },
      { ruta: "/bbva/asistencia", etiqueta: "Asistencia del equipo", descripcion: "marcas del checador de tu gente", uso: "Para revisar quién llegó, a qué hora y desde dónde.", visible: (p) => p.rol === "supervisor" || p.rol === "directivo" || (bbva(p) && p.rol !== "rh") , modulo: "rh" },
      { ruta: "/checador", etiqueta: "Checador", descripcion: "entrada, comida y salida con foto y ubicación", uso: "Cada día al llegar, al salir a comer y al terminar. Funciona sin señal y sincroniza después.", visible: () => true , personal: true },
      { ruta: "/mis-documentos", etiqueta: "Mis documentos", descripcion: "contrato, aviso de privacidad y documentos por firmar", uso: "Cuando RH te pide firmar algo o quieres consultar tu contrato.", visible: () => true , personal: true },
    ],
  },
  {
    clave: "almacen",
    titulo: "Almacén",
    proposito: "Entradas y salidas de almacén contra OC/OV, existencias y productos.",
    entradas: [
      { ruta: "/inventario", etiqueta: "Registrar movimiento", descripcion: "entradas y salidas contra las partidas de la OC/OV", uso: "Al recibir material: elige la OC, marca las partidas que llegaron y guarda; sale el comprobante con QR.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/existencias", etiqueta: "Existencias", descripcion: "lo que hay en cada almacén", uso: "Para consultar stock antes de pedir o de prometer entrega.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/productos", etiqueta: "Productos", descripcion: "catálogo de productos por empresa", uso: "Corregir nombres, unidades y códigos de barras.", visible: veInventario , modulo: "inventario" },
    ],
  },
  {
    clave: "logistica",
    titulo: "Logística",
    proposito: "Remisiones, entregas, compras y match con las órdenes.",
    entradas: [
      { ruta: "/inventario/remisiones", etiqueta: "Remisiones de salida", descripcion: "entregas de almacén con QR", uso: "Consultar, reimprimir y confirmar entregas escaneando el QR.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/match", etiqueta: "Match con OC/OV", descripcion: "avance de recepción y embarque por orden y partida", uso: "Qué falta por recibir o embarcar de cada orden; lo que el proveedor aún debe.", visible: veInventario , modulo: "inventario" },
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
      { ruta: "/proyectos", etiqueta: "Proyectos", descripcion: "obras y proyectos con sus planos y avance", uso: "Para ver o registrar una obra, su responsable y sus archivos.", visible: (p) => veOperacion(p) || modulo("proyectos")(p) , modulo: "proyectos" },
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
      { ruta: "/admin", etiqueta: "Admin", descripcion: "usuarios, roles, cuentas, reglas y proyectos", uso: "Solo el administrador: dar rol a una cuenta, altas de cuentas bancarias y reglas del motor.", visible: esAdmin , personal: true },
      { ruta: "/organigrama/configurar", etiqueta: "KPIs del organigrama", descripcion: "qué indicadores y umbrales lleva cada área", uso: "Solo dirección: elige los puntos de color de cada área del organigrama.", visible: esAdmin },
      { ruta: "/guia", etiqueta: "Guía de uso", descripcion: "qué hace cada módulo y cuándo usarlo", uso: "Cuando alguien nuevo entra al sistema o no sabe a dónde ir.", visible: () => true , personal: true },
    ],
  },
];

/** Alcance de la organización de quien mira. `null` = todavía no cargó, y
 * entonces no se esconde nada por módulo (manda RLS, esto es comodidad). */
export interface AlcanceOrganizacion {
  esMaestra: boolean;
  modulos: ModuloClave[];
}

/** Secciones con solo las entradas visibles para este perfil; las
 * secciones vacías se omiten. Un perfil 'pendiente' no ve nada.
 *
 * Con `alcance`, una organización cliente ve únicamente las entradas de los
 * módulos que tiene abiertos, más las de su propia cuenta. Que un módulo sin
 * interruptor quede fuera es a propósito: es la misma regla de la base --
 * un módulo nuevo no se le abre a nadie hasta que alguien lo decida. */
export function seccionesPara(
  perfil: Profile | null | undefined,
  alcance?: AlcanceOrganizacion | null,
): SeccionMenu[] {
  if (!perfil || perfil.rol === "pendiente") return [];
  const acotar = !!alcance && !alcance.esMaestra;
  const nivelesVisibles = (niveles: NivelMenu[] | undefined): NivelMenu[] | undefined =>
    niveles
      ?.filter((n) => !n.visible || n.visible(perfil))
      .map((n) => ({ ...n, hijos: nivelesVisibles(n.hijos) }))
      .filter((n) => !n.hijos || n.hijos.length > 0);
  return SECCIONES.map((s) => ({
    ...s,
    entradas: s.entradas
      .filter((e) => e.visible(perfil) && (!acotar || e.personal === true || (!!e.modulo && alcance!.modulos.includes(e.modulo))))
      .map((e) => (e.niveles ? { ...e, niveles: nivelesVisibles(e.niveles) } : e)),
  })).filter((s) => s.entradas.length > 0);
}

export function seccionDeRuta(ruta: string): SeccionMenu | undefined {
  return SECCIONES.find((s) => s.entradas.some((e) => ruta === e.ruta || ruta.startsWith(`${e.ruta}/`)));
}

/** ¿Esta ruta le toca a la organización de quien mira? Misma regla que
 * seccionesPara, para que el inicio no ofrezca mosaicos que el menú esconde.
 * Una ruta que no está en el catálogo se considera de plataforma: fuera para
 * una organización cliente. */
export function rutaPermitida(ruta: string, alcance?: AlcanceOrganizacion | null): boolean {
  if (!alcance || alcance.esMaestra) return true;
  const entrada = SECCIONES.flatMap((s) => s.entradas).find((e) => ruta === e.ruta || ruta.startsWith(`${e.ruta}/`));
  if (!entrada) return false;
  return entrada.personal === true || (!!entrada.modulo && alcance.modulos.includes(entrada.modulo));
}
