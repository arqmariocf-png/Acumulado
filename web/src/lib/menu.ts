import { esRhDirectivo, esRolBasico } from "./modulos.ts";
import { esContabilidad } from "./puestos.ts";
import { menuPermitido } from "./rolesDeberSer.ts";
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

export type GrupoMenu = "mi_dia" | "direccion" | "comercial" | "finanzas" | "operacion" | "nomina" | "administracion";

/** Un menú: vive en uno de los 7 grupos de la barra superior. */
export interface SeccionMenu {
  clave: string;
  /** Grupo de la barra superior al que pertenece. */
  grupo?: GrupoMenu;
  /** Departamento del organigrama (KPIs) y de los tableros de tareas. */
  area?: string;
  titulo: string;
  /** Para quién es la sección, en una línea. */
  proposito: string;
  entradas: EntradaMenu[];
}

const esAdmin = (p: Profile) => p.rol === "admin";
const esFinanzas = (p: Profile) => p.rol === "corporativo" || p.rol === "direccion" || esAdmin(p);
const bbva = (p: Profile) => !!p.bbva_mantenimiento;
const modulo = (clave: string) => (p: Profile) => esRolBasico(p.rol) && (p.modulos ?? []).includes(clave);
// Permiso por persona sin importar el rol (p. ej. Christian, responsable de
// BBVA, con requisiciones: 14-oct-2026).
const conPermiso = (clave: string) => (p: Profile) => (p.modulos ?? []).includes(clave);
// Roles que ven los módulos financieros completos (misma regla que tenía el
// menú: todo mundo menos los roles acotados).
const veFinanzasCompleto = (p: Profile) =>
  !esRolBasico(p.rol) &&
  !["responsable", "almacen", "rh_documentos", "produccion", "supervisor_bbva", "pendiente"].includes(p.rol) &&
  !(p.rol === "responsable" && bbva(p));
const esBbvaAcotado = (p: Profile) => p.rol === "responsable" && bbva(p);
const veOperacion = (p: Profile) => (veFinanzasCompleto(p) || p.rol === "responsable" || p.rol === "almacen") && !esBbvaAcotado(p);

const veInventario = (p: Profile) => veOperacion(p) || modulo("inventario")(p);
const veOrdenes = (p: Profile) => esAdmin(p) || ["almacen", "corporativo", "direccion", "empresa"].includes(p.rol) || (p.modulos ?? []).includes("compras");
// Herramienta y equipo (17-oct-2026): almacén la administra; los supervisores
// y responsables la piden para sus obras.
// Clientes: los mismos roles que leen `clientes` (clientes_select) y quien cotiza.
const veClientes = (p: Profile) =>
  veOrdenes(p) || p.rol === "produccion" || (p.modulos ?? []).some((m) => m === "cotizador" || m === "legal");
const veHerramienta = (p: Profile) =>
  esAdmin(p) || ["almacen", "corporativo", "empresa", "direccion", "responsable", "supervisor", "administrativo", "directivo"].includes(p.rol) || (p.modulos ?? []).includes("herramienta");
const veProduccion = (p: Profile) => p.rol === "produccion" || esAdmin(p) || modulo("produccion")(p);

/** Los 7 grupos de la barra superior (21-oct-2026, Excel "Acumulado deber
 * ser" de Mario: "toda la lógica de ventanas, menús y orden del sistema").
 * Agrupan por proceso, no por departamento; máximo 7 opciones por menú. */
export const GRUPOS_MENU: { clave: GrupoMenu; titulo: string }[] = [
  { clave: "mi_dia", titulo: "Mi día" },
  { clave: "direccion", titulo: "Dirección" },
  { clave: "comercial", titulo: "Comercial" },
  { clave: "finanzas", titulo: "Finanzas" },
  { clave: "operacion", titulo: "Operación" },
  { clave: "nomina", titulo: "Recursos humanos" },
  { clave: "administracion", titulo: "Administración" },
];

/** Los 22 menús del deber ser, cada uno en su grupo. `area` liga el menú con
 * el departamento del organigrama (KPIs) y con los tableros de tareas. El
 * menú, el inicio, la guía y la barra de la sección usan esta misma lista;
 * un menú sin opciones (Presupuestos, Fletes) no se pinta hasta que tenga. */
export const SECCIONES: SeccionMenu[] = [
  {
    clave: "mi_dia",
    grupo: "mi_dia",
    titulo: "Mi día",
    proposito: "Lo de cada persona: pendientes, tareas, checador, comedor y perfil.",
    entradas: [
      { ruta: "/", etiqueta: "Inicio", descripcion: "mis pendientes y alertas del día según mi puesto", uso: "Lo primero al entrar: lo que te toca hoy y las alertas con liga directa al problema.", visible: (p) => p.rol !== "pendiente", personal: true },
      { ruta: "/tareas", etiqueta: "Mis tareas", descripcion: "una sola lista de actividades, con filtro por área", uso: "Para asignar y dar seguimiento a pendientes por equipo.", visible: (p) => p.rol !== "pendiente" },
      { ruta: "/checador", etiqueta: "Checador", descripcion: "entrada, comida y salida con foto y ubicación", uso: "Cada día al llegar, al salir a comer y al terminar. Funciona sin señal y sincroniza después.", visible: () => true , personal: true },
      { ruta: "/comedor", etiqueta: "Comedor", descripcion: "pide tu comida del día; se descuenta de tu nómina", uso: "Antes de la hora límite eliges tus platillos; la cocina entrega y el descuento sale en tu nómina. Cocina y RH ven sus pestañas aquí mismo.", visible: (p) => p.rol !== "pendiente", modulo: "comedor" },
      { ruta: "/personaje", etiqueta: "Mi perfil", descripcion: "personaje, credencial QR, crédito y mis documentos", uso: "Tómate la foto de frente para crear tu personaje; cada tarea terminada y cada día que checas te da experiencia. También ves a tu equipo.", visible: (p) => p.rol !== "pendiente" , personal: true },
    ],
  },
  {
    clave: "tablero",
    grupo: "direccion",
    area: "finanzas",
    titulo: "Tablero",
    proposito: "Cómo va el grupo y lo que espera a dirección.",
    entradas: [
      { ruta: "/dashboard", etiqueta: "Resumen del grupo", descripcion: "KPIs, carga por empresa y saldos", uso: "Vista general para dirección; de aquí salen los reportes de Clavicón y saldos.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/finanzas/por-autorizar", etiqueta: "Bandeja de aprobaciones", descripcion: "OC del backoffice, requisiciones y Excel que esperan a dirección", uso: "Autoriza o rechaza; al programar el pago también se autoriza.", visible: (p) => p.rol === "direccion" || esAdmin(p), modulo: "conciliacion" },
      { ruta: "/finanzas/obras", etiqueta: "Seguimiento de obras", descripcion: "avance contra lo ejercido en OC y mano de obra, por obra", uso: "Para ver qué obra va gastando más de lo que avanza: tareas, suministro y precios unitarios contra órdenes de compra, mano de obra semanal y presupuesto.", visible: (p) => p.rol === "direccion" || esAdmin(p), modulo: "proyectos" },
    ],
  },
  {
    clave: "analisis",
    grupo: "direccion",
    area: "finanzas",
    titulo: "Análisis",
    proposito: "Resultados y reportes para decidir.",
    entradas: [
      { ruta: "/reportes", etiqueta: "Reportes", descripcion: "reportes a la medida", uso: "Consultas puntuales que no caben en las pantallas normales.", visible: veFinanzasCompleto , modulo: "conciliacion" },
    ],
  },
  {
    clave: "gobierno",
    grupo: "direccion",
    titulo: "Gobierno",
    proposito: "Socios, indicadores por área y comunicación de dirección.",
    entradas: [
      { ruta: "/socio", etiqueta: "Vista de socio", descripcion: "lo que consulta cada socio", uso: "Organizaciones, empresas y sus indicadores, como los ve cada socio.", visible: esAdmin },
      { ruta: "/organigrama/configurar", etiqueta: "Indicadores por área", descripcion: "qué indicadores y umbrales lleva cada área", uso: "Solo dirección: elige los puntos de color de cada área del organigrama.", visible: esAdmin },
      { ruta: "/admin/mensaje-semana", etiqueta: "Mensaje de la semana", descripcion: "tu agradecimiento al equipo, sábados 1 p. m.", uso: "Solo el director general: elige o escribe la frase, pruébala contigo y queda programada para el sábado.", visible: esAdmin },
    ],
  },
  {
    clave: "ventas",
    grupo: "comercial",
    area: "compras",
    titulo: "Ventas",
    proposito: "Cotizar, vender y dar seguimiento a clientes.",
    entradas: [
      { ruta: "/cotizador", etiqueta: "Cotizaciones", descripcion: "cotizaciones a clientes de cualquier empresa", uso: "Cotiza con los productos de la empresa y los clientes registrados; el margen solo lo ves tú; aceptada, se convierte en orden de venta.", visible: (p) => veOrdenes(p) || p.rol === "produccion" || (p.modulos ?? []).includes("cotizador"), modulo: "inventario" },
      { ruta: "/ventas/crm", etiqueta: "CRM", descripcion: "WhatsApp y redes: contactos, cotización automática y seguimiento", uso: "Pega lo que escribió el cliente; el sistema arma la cotización con los productos de la empresa, la revisas y la mandas por WhatsApp; ganada, se vuelve orden de venta.", visible: (p) => veOrdenes(p) || p.rol === "produccion" || (p.modulos ?? []).includes("cotizador"), modulo: "inventario" },
      { ruta: "/ordenes?tipo=OV", etiqueta: "Órdenes de venta", descripcion: "folio IA-OV: venta a cliente", uso: "Captura cliente y partidas; almacén surte la salida contra la OV.", visible: veOrdenes, modulo: "inventario" },
      { ruta: "/punto-venta", etiqueta: "Punto de venta (mostrador)", descripcion: "mostrador de ferretería: cobra con código de barras, caja y despacho", uso: "Escanea los productos, cobra (efectivo, tarjeta, transferencia o crédito), imprime el ticket y despacha al escanear el ticket.", visible: (p) => esAdmin(p) || p.rol === "almacen" || p.rol === "corporativo" || (p.modulos ?? []).includes("punto_venta"), modulo: "punto_venta" },
    ],
  },
  {
    clave: "cobranza",
    grupo: "comercial",
    area: "finanzas",
    titulo: "Cobranza",
    proposito: "Lo que nos deben los clientes y su crédito.",
    entradas: [
      { ruta: "/legal?tab=credito", etiqueta: "Crédito a clientes", descripcion: "línea, días de crédito y contrato por cliente", uso: "Dirección autoriza la línea de crédito del cliente y se genera el contrato de los abogados.", visible: (p) => esAdmin(p) || p.rol === "direccion" || (p.modulos ?? []).includes("legal"), modulo: "legal" },
    ],
  },
  {
    clave: "compras",
    grupo: "comercial",
    area: "compras",
    titulo: "Compras",
    proposito: "Requisiciones y órdenes de compra y servicio.",
    entradas: [
      { ruta: "/requisiciones", etiqueta: "Requisiciones", descripcion: "solicitudes de material por obra", uso: "El responsable pide; compras resuelve renglón por renglón.", visible: (p) => veOperacion(p) || modulo("requisiciones")(p) || modulo("proyectos")(p) || conPermiso("requisiciones")(p) },
      { ruta: "/ordenes", etiqueta: "Órdenes de compra y servicio", descripcion: "una sola lista y un solo consecutivo", uso: "Material (OC) y servicios o subcontratos (OS) juntos, con filtro por tipo y un solo Excel; dirección las autoriza y se programa el pago. La OS no entra a inventario.", visible: veOrdenes, modulo: "inventario" },
    ],
  },
  {
    clave: "almacen",
    grupo: "comercial",
    area: "almacen",
    titulo: "Almacén",
    proposito: "Recibir, entregar, existencias y herramienta.",
    entradas: [
      { ruta: "/inventario/por-recibir", etiqueta: "Por recibir", descripcion: "OC ya pagadas que faltan de confirmar, en bodega u obra", uso: "Tesorería pagó; almacén u obra confirma qué llegó y cuánto, partida por partida.", visible: veInventario, modulo: "inventario" },
      { ruta: "/inventario", etiqueta: "Entradas y salidas", descripcion: "entradas y salidas contra las partidas de la OC/OV", uso: "Al recibir material: elige la OC, marca las partidas que llegaron y guarda; sale el comprobante con QR.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/remisiones", etiqueta: "Remisiones", descripcion: "entregas de almacén con QR", uso: "Consultar, reimprimir y confirmar entregas escaneando el QR.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/existencias", etiqueta: "Existencias", descripcion: "lo que hay en cada almacén", uso: "Para consultar stock antes de pedir o de prometer entrega.", visible: veInventario , modulo: "inventario" },
      { ruta: "/inventario/resumen", etiqueta: "Resumen de inventario", descripcion: "valor por empresa y días en que se cargó la información", uso: "Ver qué tan al día está el inventario: última captura por empresa y qué se registró cada día.", visible: veInventario, modulo: "inventario" },
      { ruta: "/inventario/match", etiqueta: "Match con OC/OV", descripcion: "avance de recepción y embarque por orden y partida", uso: "Qué falta por recibir o embarcar de cada orden; lo que el proveedor aún debe.", visible: veInventario , modulo: "inventario" },
      { ruta: "/almacen/herramienta", etiqueta: "Herramienta y equipo", descripcion: "piezas con folio, solicitudes de obra y resguardos", uso: "El supervisor pide para su obra; almacén surte con las piezas (folio y etiqueta), imprime el resguardo para firma y recibe de regreso.", visible: veHerramienta, modulo: "inventario" },
    ],
  },
  {
    clave: "tesoreria",
    grupo: "finanzas",
    area: "finanzas",
    titulo: "Tesorería",
    proposito: "Bancos, pagos del día, efectivo y préstamos entre empresas.",
    entradas: [
      { ruta: "/finanzas/tesoreria", etiqueta: "Pagos de hoy", descripcion: "semáforo por empresa y pagos del día con datos bancarios", uso: "Tesorería paga lo que dirección programó: saldo del banco contra lo pendiente de hoy, CLABE a la mano y marca pagado.", visible: esFinanzas, modulo: "conciliacion" },
      { ruta: "/finanzas/pagos", etiqueta: "Programación de pagos", descripcion: "calendario de pagos por empresa", uso: "Para programar y dar seguimiento a los pagos de la semana.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/finanzas/saldos", etiqueta: "Bancos y saldos", descripcion: "inicio y cierre por empresa, sin detalle", uso: "El resumen rápido para finanzas antes de programar pagos.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/saldos", etiqueta: "Saldos diarios por cuenta", descripcion: "corte por cuenta bancaria", uso: "Saldo de inicio y cierre de cada cuenta por día.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/movimientos", etiqueta: "Conciliación bancaria", descripcion: "movimientos bancarios conciliados contra CFDI", uso: "Para revisar lo ambiguo, duplicado o sin factura después de cargar un estado de cuenta.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/finanzas/efectivo", etiqueta: "Efectivo", descripcion: "OC que se pagan en efectivo: proveedor, monto y orden", uso: "Elige una o varias, confirma el pago y sube un solo comprobante para todas.", visible: (p) => p.rol === "direccion" || esAdmin(p), modulo: "conciliacion" },
      { ruta: "/prestamos-intercompania", etiqueta: "Préstamos entre empresas", descripcion: "movimientos intercompañía", uso: "Cuando una empresa del grupo le presta a otra: queda registrado de los dos lados.", visible: veFinanzasCompleto , modulo: "conciliacion" },
    ],
  },
  {
    clave: "cuentas_pagar",
    grupo: "finanzas",
    area: "finanzas",
    titulo: "Cuentas por pagar",
    proposito: "Lo que se debe a proveedores, gastos y el historial de pagos.",
    entradas: [
      { ruta: "/finanzas/proveedores", etiqueta: "Saldos por proveedor", descripcion: "saldo por proveedor y por empresa, con su línea de crédito", uso: "El primer candado al revisar OC: cuánto se le debe a cada proveedor y cuánta línea de crédito le queda.", visible: esFinanzas , modulo: "conciliacion" },
      { ruta: "/finanzas/lineas-credito", etiqueta: "Líneas de crédito de proveedores", descripcion: "monto, días y vencimiento por proveedor", uso: "Solo dirección: captura la línea de crédito de cada proveedor y su fecha de vencimiento; de ahí sale el semáforo de cuentas por pagar.", visible: (p) => p.rol === "direccion" || esAdmin(p), modulo: "conciliacion" },
      { ruta: "/gastos", etiqueta: "Comprobación de gastos", descripcion: "caja chica y gastos de obra con factura o nota", uso: "El supervisor sube el comprobante con monto y obra; finanzas recibe el aviso y lo aprueba.", visible: (p) => ["supervisor", "responsable", "directivo", "administrativo", "corporativo", "direccion", "empresa", "admin"].includes(p.rol) , modulo: "conciliacion" },
      { ruta: "/finanzas/deuda", etiqueta: "Deuda financiera", descripcion: "préstamos de bancos, arrendadoras y particulares por empresa", uso: "Sube los préstamos (uno por uno o desde Excel), registra sus pagos y ve saldo, próximos pagos, vencidos y la tabla de amortización.", visible: (p) => p.rol === "direccion" || esAdmin(p) || conPermiso("tesoreria")(p) || conPermiso("contabilidad")(p), modulo: "conciliacion" },
      { ruta: "/finanzas/historial-pagos", etiqueta: "Base de OC y pagos", descripcion: "OC, proveedor, fecha, estatus, detalle y comprobante de cualquier día o semana", uso: "Para consultar en el pasado: qué se pagó, a quién, con qué comprobante; por día, semana o mes, y descargar a Excel.", visible: esFinanzas, modulo: "conciliacion" },
    ],
  },
  {
    clave: "presupuestos",
    grupo: "finanzas",
    area: "finanzas",
    titulo: "Presupuestos",
    proposito: "Presupuesto anual, por obra y contra real.",
    entradas: [
      { ruta: "/finanzas/avance-financiero", etiqueta: "Avance financiero de obras", descripcion: "presupuesto contra real, pagado y pendiente por obra, empresa, periodo y categoría", uso: "Captura el presupuesto de cada obra por categoría; lo real (OC, OS y mano de obra) y lo pagado salen solos. El semáforo avisa qué obra gasta más de lo que avanza o ya rebasó su presupuesto.", visible: (p) => p.rol === "direccion" || p.rol === "empresa" || esAdmin(p), modulo: "proyectos" },
    ],
  },
  {
    clave: "contabilidad",
    grupo: "finanzas",
    area: "contabilidad",
    titulo: "Contabilidad",
    proposito: "Carga de archivos, pendientes, datos fiscales y SAT.",
    entradas: [
      { ruta: "/carga", etiqueta: "Carga de archivos", descripcion: "estados de cuenta, CFDI y catálogo OC/OV", uso: "Cada corte: sube el PDF del banco y el zip de CFDI; el catálogo OC/OV se trae del backoffice.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/pendientes", etiqueta: "Pendientes", descripcion: "concentrado por proveedor", uso: "Qué falta pagar o facturar, agrupado por proveedor.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/perfil-fiscal", etiqueta: "Perfil fiscal", descripcion: "datos fiscales y legales de cada empresa", uso: "Razón social, RFC, representante legal y domicilio que salen en contratos y documentos.", visible: veFinanzasCompleto , modulo: "conciliacion" },
      { ruta: "/contabilidad/efirmas-sat", etiqueta: "e.firma del SAT", descripcion: "e.firma de cada empresa para bajar los CFDI del SAT", uso: "Sube el .cer, el .key y la contraseña de cada empresa una vez; con eso la descarga masiva del SAT corre sola. Avisa cuando una e.firma está por vencer.", visible: (p) => esAdmin(p) || esContabilidad(p), modulo: "conciliacion" },
      { ruta: "/finanzas/seguro-social-obras", etiqueta: "Seguro social de obras", descripcion: "contabilidad captura el seguro social del costeo de cada obra", uso: "Cuando dirección asigna personal a una obra: calcula el seguro social y captúralo.", visible: (p) => p.rol === "corporativo" || p.rol === "admin", modulo: "conciliacion" },
    ],
  },
  {
    clave: "obras",
    grupo: "operacion",
    area: "operacion",
    titulo: "Obras",
    proposito: "Proyectos, planos, avance y precios unitarios.",
    entradas: [
      { ruta: "/proyectos", etiqueta: "Proyectos", descripcion: "obras y proyectos con sus planos y avance", uso: "Para ver o registrar una obra, su responsable y sus archivos.", visible: (p) => veOperacion(p) || modulo("proyectos")(p) , modulo: "proyectos" },
      { ruta: "/precios", etiqueta: "Precios unitarios", descripcion: "análisis de precio unitario y catálogo de insumos", uso: "Para cotizar: arma el análisis, almacén pone precios, dirección autoriza y se publica.", visible: (p) => veOperacion(p) || modulo("precios")(p) },
    ],
  },
  {
    clave: "produccion",
    grupo: "operacion",
    area: "operacion",
    titulo: "Producción",
    proposito: "Las plantas: Clavicón, Balken y carpintería.",
    entradas: [
      { ruta: "/produccion/clavicon", etiqueta: "Clavicón", descripcion: "mallas y clavos: lotes, órdenes y calendario de máquinas", uso: "Registra materia prima, programa la producción y genera remisiones al cliente.", visible: veProduccion },
      { ruta: "/produccion/balken", etiqueta: "Balken", descripcion: "vigueta y bovedilla, con despiece para cotizar", uso: "Cotiza losas por despiece y controla la producción.", visible: veProduccion },
      { ruta: "/produccion/carpinteria", etiqueta: "Carpintería", descripcion: "taller de carpintería", uso: "Órdenes de producción y remisiones del taller.", visible: veProduccion },
      { ruta: "/clavicon", etiqueta: "Panorama Clavicón", descripcion: "calendario de procesos y reporte oficial", uso: "Solo dirección: el estado completo de la planta en un documento.", visible: esAdmin },
    ],
  },
  {
    clave: "fletes",
    grupo: "operacion",
    area: "logistica",
    titulo: "Fletes",
    proposito: "Viajes, unidades, choferes y combustible de Loma Racing.",
    entradas: [],
  },
  {
    clave: "mantenimiento_bbva",
    grupo: "operacion",
    area: "mantenimiento",
    titulo: "Mantenimiento BBVA",
    proposito: "El contrato de CSC con BBVA: folios, control y equilibrio.",
    entradas: [
      { ruta: "/mantenimiento/bbva", etiqueta: "Control BBVA", descripcion: "folios, estatus por paso y conciliación", uso: "Seguimiento de cada folio desde que se abre hasta que se cobra.", visible: (p) => esFinanzas(p) || bbva(p) },
      { ruta: "/bbva/folios", etiqueta: "Folios", descripcion: "semáforo de atención de las cuadrillas", uso: "Qué folios están por vencer o sin atender hoy.", visible: (p) => p.rol === "supervisor_bbva" || esFinanzas(p) || bbva(p) || modulo("bbva")(p) },
      { ruta: "/bbva/equilibrio", etiqueta: "Punto de equilibrio", descripcion: "gasto del equipo contra folios cobrados", uso: "Para saber si la operación BBVA se paga sola en el mes.", visible: (p) => esFinanzas(p) || p.rol === "rh" || bbva(p) },
    ],
  },
  {
    clave: "rh",
    grupo: "nomina",
    area: "rh",
    titulo: "Recursos humanos",
    proposito: "Expedientes, asistencia, EPP y accesos al sistema.",
    entradas: [
      { ruta: "/tareas/area/rh", etiqueta: "Tablero de RH", descripcion: "actividades del equipo de recursos humanos", uso: "El tablero de tareas de RH (RH · Actividades): lo que asigna RH, quién lo tiene y qué está vencido. De ahí se organiza lo demás.", visible: (p) => p.rol === "rh" || p.rol === "rh_documentos" || esAdmin(p), modulo: "rh" },
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
          { etiqueta: "Accesos al sistema", ruta: "/rh?tab=accesos" },
        ],
      },
      { ruta: "/bbva/asistencia", etiqueta: "Asistencia de mi equipo", descripcion: "marcas del checador de tu gente", uso: "Para revisar quién llegó, a qué hora y desde dónde.", visible: (p) => p.rol === "supervisor" || p.rol === "directivo" || (p.modulos ?? []).includes("checador") || (bbva(p) && p.rol !== "rh") , modulo: "rh" },
      { ruta: "/epp/solicitar", etiqueta: "Solicitar EPP", descripcion: "casco, chaleco, botas… para tu gente", uso: "El supervisor o responsable de obra pide el equipo de protección de su gente; RH lo entrega de bodega o lo pide a compras y la persona firma su responsiva.", visible: (p) => ["supervisor", "responsable", "rh"].includes(p.rol) || esAdmin(p), modulo: "rh" },
    ],
  },
  {
    clave: "nomina",
    grupo: "nomina",
    area: "rh",
    titulo: "Nómina",
    proposito: "Pagos de nómina, préstamos y descuentos a empleados.",
    entradas: [
      {
        ruta: "/financiamiento",
        etiqueta: "Préstamos y descuentos",
        descripcion: "estudio, líneas por trabajador y descuentos vía nómina",
        uso: "Estudio por antigüedad, asistencia, tareas, cuidado de herramienta e historial de pago; autoriza la línea de cada trabajador (sin intereses, topes de ley), registra préstamos y anticipos y aplica los descuentos de cada viernes.",
        visible: (p) => esAdmin(p) || p.rol === "direccion" || p.rol === "rh",
        modulo: "rh",
      },
      { ruta: "/rh/agenda-pagos", etiqueta: "Agenda de pagos de nómina", descripcion: "calendario de pagos de nómina", uso: "Qué se paga cada semana y quincena.", visible: (p) => p.rol === "rh" || esAdmin(p) , modulo: "rh" },
    ],
  },
  {
    clave: "mano_obra",
    grupo: "nomina",
    area: "rh",
    titulo: "Mano de obra",
    proposito: "Contratistas y destajos de obra.",
    entradas: [
      { ruta: "/rh/mano-de-obra", etiqueta: "Pagos de mano de obra", descripcion: "nómina externa de las APIs de Grupo Loma", uso: "Costo de mano de obra por periodo y por obra.", visible: (p) => p.rol === "rh" || esAdmin(p) , modulo: "rh" },
    ],
  },
  {
    clave: "legal",
    grupo: "administracion",
    area: "legal",
    titulo: "Legal y cumplimiento",
    proposito: "Asuntos, contratos, crédito a clientes y controles.",
    entradas: [
      {
        ruta: "/legal",
        etiqueta: "Asuntos y contratos",
        descripcion: "asuntos y juicios, crédito a clientes y contratos",
        uso: "Bitácora de cada asunto con su próxima actuación y documentos; el contrato de crédito de los abogados se llena solo cuando dirección autoriza el crédito del cliente.",
        visible: (p) => esAdmin(p) || p.rol === "direccion" || (p.modulos ?? []).includes("legal"),
        modulo: "legal",
        niveles: [
          { etiqueta: "Asuntos y juicios", ruta: "/legal?tab=asuntos", visible: (p) => esAdmin(p) || (p.modulos ?? []).includes("legal") },
          { etiqueta: "Crédito y contratos", ruta: "/legal?tab=credito" },
          { etiqueta: "Arrendamientos", ruta: "/legal?tab=arrendamientos", visible: (p) => esAdmin(p) || (p.modulos ?? []).includes("legal") },
          { etiqueta: "Datos legales de las empresas", ruta: "/legal?tab=empresa", visible: (p) => esAdmin(p) || (p.modulos ?? []).includes("legal") },
        ],
      },
      {
        ruta: "/cumplimiento",
        etiqueta: "Cumplimiento",
        descripcion: "normas, controles, incidencias e informe al comité",
        uso: "Vuelve cada norma nueva tareas con responsable; prueba los controles contra los datos del sistema (pagos, bancos, SAT, RH, almacén…) y dice qué casos fallan; informa incidencias con calma y arma el informe al comité en una página.",
        visible: (p) => esAdmin(p) || p.rol === "direccion" || (p.modulos ?? []).some((m) => m === "legal" || m === "cumplimiento"),
        modulo: "legal",
        niveles: [
          { etiqueta: "Cambios normativos", ruta: "/cumplimiento?tab=normas" },
          { etiqueta: "Revisar controles", ruta: "/cumplimiento?tab=controles" },
          { etiqueta: "Incidencias", ruta: "/cumplimiento?tab=incidencias" },
          { etiqueta: "Informe al comité", ruta: "/cumplimiento?tab=comite" },
          { etiqueta: "Flujos de control", ruta: "/cumplimiento?tab=flujos" },
        ],
      },
    ],
  },
  {
    clave: "catalogos",
    grupo: "administracion",
    area: "sistemas",
    titulo: "Catálogos",
    proposito: "Empresas, proveedores, items y clientes del grupo.",
    entradas: [
      { ruta: "/catalogos/empresas", etiqueta: "Empresas", descripcion: "razón social, RFC, domicilio y cuenta para depósito", uso: "Dirección da de alta y corrige las empresas del grupo con los datos que salen impresos en órdenes y cotizaciones; las que ya no operan se desactivan.", visible: (p) => esAdmin(p) || p.rol === "direccion", modulo: "inventario" },
      { ruta: "/compras/catalogo", etiqueta: "Proveedores y costos", descripcion: "alta, precios de lista e histórico de costos", uso: "Da de alta proveedores y lo que te venden con su precio s/IVA; ve cuánto les has pagado por cada cosa y compara precios entre proveedores.", visible: veOrdenes, modulo: "inventario" },
      { ruta: "/compras/items", etiqueta: "Items", descripcion: "materiales, consumibles, herramienta y servicios sin proveedor", uso: "Da de alta cada item una vez (clave, unidad, categoría, IVA y precio de referencia s/IVA); sale en el buscador de órdenes y requisiciones y cada proveedor liga su precio.", visible: veOrdenes, modulo: "inventario" },
      { ruta: "/inventario/productos", etiqueta: "Productos por empresa", descripcion: "catálogo de productos por empresa", uso: "Corregir nombres, unidades y códigos de barras.", visible: veInventario , modulo: "inventario" },
      { ruta: "/catalogos/clientes", etiqueta: "Clientes", descripcion: "datos fiscales y de contacto", uso: "Alta y corrección de clientes; salen en el cotizador, las OV, el punto de venta, el CRM y crédito. Si ya se usó, se desactiva en vez de borrarse.", visible: veClientes, modulo: "inventario" },
    ],
  },
  {
    clave: "configuracion",
    grupo: "administracion",
    area: "sistemas",
    titulo: "Configuración",
    proposito: "Usuarios y permisos, plan del sistema, respaldo y guía.",
    entradas: [
      { ruta: "/admin", etiqueta: "Usuarios y permisos", descripcion: "usuarios, roles, cuentas, reglas y proyectos", uso: "Solo el administrador: dar rol a una cuenta, altas de cuentas bancarias y reglas del motor.", visible: esAdmin , personal: true },
      { ruta: "/admin/plan-sistema", etiqueta: "Plan del sistema", descripcion: "las 100 opciones del deber ser: fase, responsable y avance", uso: "Para dar seguimiento al acomodo del sistema: qué ya funciona, qué falta crear o migrar del backoffice, quién lo lleva y para cuándo.", visible: (p) => esAdmin(p) || p.rol === "direccion" },
      { ruta: "/admin/respaldo-dropbox", etiqueta: "Respaldo en Dropbox", descripcion: "proyectos a cotizar, para leerlos desde Claude", uso: "Solo el director general: conecta tu Dropbox una vez y cada noche se copian proyectos, planos, precios unitarios y cotizaciones (CSV con su índice) para cotizar más rápido desde Claude.", visible: esAdmin },
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
  }))
    // Roles del deber ser: esconde los menús que su puesto no usa (apagado
    // hasta que Mario valide las equivalencias; ver lib/rolesDeberSer.ts).
    .filter((s) => s.entradas.length > 0 && menuPermitido(perfil, s.clave));
}

export function seccionDeRuta(ruta: string): SeccionMenu | undefined {
  return SECCIONES.find((s) => s.entradas.some((e) => ruta === e.ruta || ruta.startsWith(`${e.ruta}/`)));
}

/** ¿Esta ruta le toca a la organización de quien mira? Misma regla que
 * seccionesPara, para que el inicio no ofrezca mosaicos que el menú esconde.
 * Una ruta que no está en el catálogo se considera de plataforma: fuera para
 * una organización cliente. */
export function rutaPermitida(rutaConFiltro: string, alcance?: AlcanceOrganizacion | null): boolean {
  if (!alcance || alcance.esMaestra) return true;
  // Los atajos del tablero llevan filtro (?ver=…, #sección): se valida la ruta.
  const ruta = rutaConFiltro.split(/[?#]/)[0];
  const entrada = SECCIONES.flatMap((s) => s.entradas).find((e) => ruta === e.ruta || ruta.startsWith(`${e.ruta}/`));
  if (!entrada) return false;
  return entrada.personal === true || (!!entrada.modulo && alcance.modulos.includes(entrada.modulo));
}
