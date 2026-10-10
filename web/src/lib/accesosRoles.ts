import { SECCIONES } from "./menu.ts";
import { MODULOS_ASIGNABLES, MODULOS_BASE, ROLES_BASICOS, esRolBasico } from "./modulos.ts";
import type { AppRol, Profile } from "../types/database";

// Organigrama de accesos por rol (Mario, 26-sep-2026): qué ve y qué edita
// cada rol, para trabajarlo desde una sola pantalla. "Ve" se calcula del
// catálogo del menú (lib/menu.ts) con un perfil de muestra por rol, así no
// se desactualiza. "Edita" es un resumen escrito a mano de las policies de
// la base: si cambia una policy, hay que actualizar EDITA. Sin DOM.

export const ETIQUETA_ROL: Record<AppRol, string> = {
  admin: "Director general (admin)",
  corporativo: "Corporativo",
  direccion: "Dirección / finanzas",
  empresa: "Empresa (dirección de una empresa)",
  rh: "Recursos humanos",
  almacen: "Almacén",
  produccion: "Producción",
  responsable: "Responsable de obra",
  rh_documentos: "RH · expedientes",
  supervisor_bbva: "Supervisor BBVA",
  directivo: "Directivo (personal)",
  supervisor: "Supervisor (personal)",
  administrativo: "Administrativo (personal)",
  operativo: "Operativo (personal)",
  pendiente: "Pendiente (sin acceso)",
};

export const DESCRIPCION_ROL: Record<AppRol, string> = {
  admin: "Director general: ve y edita todo el sistema (policy director_general en todas las tablas), todas las organizaciones. Da roles y accesos.",
  corporativo: "Todas las empresas de su organización; captura y resuelve.",
  direccion: "Todas las empresas, finanzas y autorizaciones; consulta sin capturar operación.",
  empresa: "Su empresa completa: proyectos, precios unitarios, tableros y control de obra.",
  rh: "Personal, expedientes, contratos, checador y accesos (directivo) o flujo operativo (administrativo).",
  almacen: "Entradas, salidas, remisiones y existencias de su empresa; confirma material de PU.",
  produccion: "Plantas (Clavicón, Balken, Carpintería), lotes y remisiones de planta.",
  responsable: "Sus proyectos y los de su empresa: requisiciones, PU, tableros, control de obra.",
  rh_documentos: "Solo captura de expedientes, bajo RH.",
  supervisor_bbva: "Folios y semáforo de la cuadrilla BBVA.",
  directivo: "Checador de todo el personal, tareas y los módulos que RH le asigne.",
  supervisor: "Checador de su gente, tareas y los módulos que RH le asigne.",
  administrativo: "Checador, tareas y los módulos que RH le asigne.",
  operativo: "Checador y tareas.",
  pendiente: "Cuenta registrada sin rol: no ve nada hasta que el administrador la asigne.",
};

/** Niveles del organigrama, de arriba hacia abajo. */
export const NIVELES_ROLES: { titulo: string; roles: AppRol[] }[] = [
  { titulo: "Administración de la plataforma", roles: ["admin"] },
  { titulo: "Dirección general", roles: ["corporativo", "direccion"] },
  { titulo: "Áreas y empresas", roles: ["empresa", "rh", "almacen", "produccion"] },
  { titulo: "Responsables y acotados", roles: ["responsable", "rh_documentos", "supervisor_bbva", "directivo"] },
  { titulo: "Personal con supervisión", roles: ["supervisor", "administrativo"] },
  { titulo: "Personal operativo", roles: ["operativo"] },
  { titulo: "Sin acceso", roles: ["pendiente"] },
];

/** Qué edita cada rol en cada ruta del menú. Resumen de las policies. */
export const EDITA: Record<string, Partial<Record<AppRol, string>>> = {
  "/dashboard": { admin: "todo", corporativo: "todo", direccion: "solo consulta" },
  "/finanzas/saldos": { admin: "todo", corporativo: "todo", direccion: "solo consulta" },
  "/finanzas/proveedores": { admin: "captura líneas de crédito", corporativo: "captura líneas de crédito", direccion: "captura líneas de crédito" },
  "/finanzas/lineas-credito": { admin: "captura", direccion: "captura (menú propio)" },
  "/finanzas/tesoreria": { admin: "todo", corporativo: "marca pagado con referencia, captura datos bancarios del proveedor", direccion: "igual que corporativo" },
  "/finanzas/pagos": { admin: "todo", corporativo: "todo", direccion: "programa pagos por OC (contado / crédito / anticipo / efectivo), marca pagado; el saldo por OC se calcula", almacen: "solo lee los pagos ligados a OC (para Por recibir)", responsable: "solo lee los pagos ligados a OC" },
  "/saldos": { admin: "todo", corporativo: "todo", direccion: "solo consulta" },
  "/prestamos-intercompania": { admin: "todo", corporativo: "todo", direccion: "solo consulta" },
  "/finanzas/seguro-social-obras": { admin: "ve y captura", corporativo: "captura el seguro social (ve solo el personal asignado)" },
  "/punto-venta": { admin: "vende, cancela, precios y caja", almacen: "vende, despacha, cancela, precios y caja", corporativo: "vende, despacha, cancela, precios y caja", operativo: "con permiso punto de venta: vende y despacha", administrativo: "con permiso punto de venta: vende y despacha", supervisor: "con permiso punto de venta: vende y despacha", directivo: "con permiso punto de venta: vende y despacha" },
  "/comedor": { admin: "cocina, nómina y pide", corporativo: "cocina, nómina y pide", direccion: "descuento vía nómina y pide", rh: "descuento vía nómina y pide", operativo: "pide su comida (con módulo comedor: cocina)", administrativo: "pide su comida (con módulo comedor: cocina)", supervisor: "pide su comida (con módulo comedor: cocina)", directivo: "pide su comida (con módulo comedor: cocina)", responsable: "pide su comida (con módulo comedor: cocina)", almacen: "pide su comida (con módulo comedor: cocina)", empresa: "pide su comida (con módulo comedor: cocina)", produccion: "pide su comida (con módulo comedor: cocina)" },
  "/gastos": { admin: "revisa y aprueba", corporativo: "revisa y aprueba", direccion: "revisa y aprueba", empresa: "comprueba", responsable: "comprueba", supervisor: "comprueba", directivo: "comprueba", administrativo: "comprueba" },
  "/movimientos": { admin: "clasifica y concilia", corporativo: "clasifica y concilia", direccion: "solo consulta" },
  "/carga": { admin: "sube archivos", corporativo: "sube archivos", direccion: "solo consulta" },
  "/pendientes": { admin: "resuelve", corporativo: "resuelve", direccion: "solo consulta" },
  "/legal": { admin: "todo", direccion: "autoriza el crédito de clientes y genera contratos", corporativo: "con permiso legal: asuntos, crédito (sin autorizar), contratos y arrendamientos", rh: "con permiso legal: asuntos, crédito (sin autorizar), contratos y arrendamientos" },
  "/perfil-fiscal": { admin: "edita", corporativo: "edita", direccion: "solo consulta" },
  "/reportes": { admin: "genera", corporativo: "genera", direccion: "genera" },
  "/rh": { admin: "todo", rh: "directivo: todo, accesos y roles · administrativo: contratos, expedientes, checador, crea cuentas y manda links/contraseñas temporales", rh_documentos: "solo expedientes" },
  "/rh/mano-de-obra": { admin: "consulta", rh: "consulta" },
  "/rh/agenda-pagos": { admin: "edita", rh: "edita" },
  "/bbva/asistencia": { supervisor: "consulta a su gente", directivo: "consulta a todos" },
  "/checador": { admin: "marca la propia", corporativo: "marca la propia", direccion: "marca la propia", empresa: "marca la propia", rh: "marca la propia", almacen: "marca la propia", produccion: "marca la propia", responsable: "marca la propia", rh_documentos: "marca la propia", supervisor_bbva: "marca la propia", directivo: "marca la propia", supervisor: "marca la propia", administrativo: "marca la propia", operativo: "marca la propia" },
  "/mis-documentos": { admin: "firma los propios", corporativo: "firma los propios", direccion: "firma los propios", empresa: "firma los propios", rh: "firma los propios", almacen: "firma los propios", produccion: "firma los propios", responsable: "firma los propios", rh_documentos: "firma los propios", supervisor_bbva: "firma los propios", directivo: "firma los propios", supervisor: "firma los propios", administrativo: "firma los propios", operativo: "firma los propios" },
  "/inventario": { admin: "registra", corporativo: "registra", empresa: "registra en su empresa", almacen: "registra en su empresa", responsable: "registra en su empresa", supervisor: "con módulo: registra", directivo: "con módulo: registra", administrativo: "con módulo: registra", operativo: "con módulo: registra" },
  "/inventario/existencias": { admin: "consulta", corporativo: "consulta", empresa: "consulta", almacen: "consulta", responsable: "consulta", direccion: "consulta" },
  "/inventario/resumen": { admin: "consulta", corporativo: "consulta", empresa: "consulta", almacen: "consulta", responsable: "consulta", direccion: "consulta" },
  "/inventario/productos": { admin: "alta y edición", corporativo: "alta y edición", empresa: "alta en su empresa", almacen: "alta en su empresa" },
  "/inventario/remisiones": { admin: "emite y confirma", corporativo: "emite y confirma", empresa: "emite y confirma", almacen: "emite y confirma", responsable: "confirma entrega", supervisor: "con módulo: confirma", directivo: "con módulo: confirma", administrativo: "con módulo: confirma", operativo: "con módulo: confirma" },
  "/inventario/por-recibir": { admin: "confirma recepción", corporativo: "confirma recepción", almacen: "confirma cantidades y lugar (bodega/obra)", empresa: "confirma recepción en obra", responsable: "confirma recepción en obra" },
  "/inventario/match": { admin: "consulta", corporativo: "consulta", empresa: "consulta", almacen: "consulta", responsable: "consulta" },
  "/requisiciones": { admin: "crea, resuelve y marca etapas; marca pedido/entregado, devolución o cambio y comenta por renglón", corporativo: "crea, resuelve y marca etapas; marca pedido/entregado, devolución o cambio y comenta por renglón", direccion: "autoriza, paga y regresa etapas; marca pedido/entregado, devolución o cambio y comenta por renglón", empresa: "autoriza, suministro, bodega, tránsito, recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", almacen: "abre cada requisición, compra en un paso (OC serie RQ), surte de existencia, ve la orden y confirma cantidades recibidas por partida; suministro, bodega, tránsito, recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", responsable: "crea las de sus proyectos, edita/quita renglones o cancela mientras esté enviada, marca recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", supervisor: "con módulo proyectos: crea las de su empresa; marca recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", directivo: "con módulo proyectos: crea las de su empresa; marca recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", administrativo: "con módulo proyectos: crea las de su empresa; marca recibida; marca pedido/entregado, devolución o cambio y comenta por renglón", operativo: "con módulo: marca recibida si es del proyecto; marca pedido/entregado, devolución o cambio y comenta por renglón" },
  "/mantenimiento/bbva": { admin: "todo", corporativo: "todo", direccion: "consulta" },
  "/bbva/folios": { admin: "todo", corporativo: "todo", supervisor_bbva: "captura folios", direccion: "consulta" },
  "/bbva/equilibrio": { admin: "consulta", corporativo: "consulta", direccion: "consulta", rh: "consulta" },
  "/proyectos": { admin: "crea proyectos, tableros, control de obra y planos", corporativo: "crea proyectos, tableros, control de obra y planos", direccion: "captura control de obra (presupuesto, compras, nómina); lo demás lo consulta", empresa: "tableros, control de obra, planos y autorización del cliente en su empresa", responsable: "tableros, control de obra y planos en su empresa", supervisor: "con módulo: tableros, control de obra y planos en su empresa", directivo: "con módulo: tableros, control de obra y planos en su empresa", administrativo: "con módulo: tableros, control de obra y planos en su empresa", operativo: "con módulo: tableros, control de obra y planos en su empresa" },
  "/precios": { admin: "todo (publica y factores)", corporativo: "elabora", direccion: "autoriza", empresa: "elabora y autoriza con el cliente", responsable: "elabora los de sus proyectos", almacen: "confirma material y precios", supervisor: "con módulo: elabora", directivo: "con módulo: elabora", administrativo: "con módulo: elabora", operativo: "con módulo: elabora" },
  "/tareas": { admin: "crea tableros y todo", corporativo: "crea tableros y todo", direccion: "mueve y comenta", empresa: "crea tableros de su empresa, mueve y comenta", rh: "mueve y comenta", almacen: "mueve y comenta", produccion: "mueve y comenta", responsable: "crea tableros de su empresa, mueve y comenta", rh_documentos: "mueve y comenta", supervisor_bbva: "mueve y comenta", directivo: "mueve y comenta", supervisor: "mueve y comenta", administrativo: "mueve y comenta", operativo: "mueve y comenta" },
  "/produccion/clavicon": { admin: "todo", produccion: "captura lotes y remisiones", supervisor: "con módulo: captura", directivo: "con módulo: captura", administrativo: "con módulo: captura", operativo: "con módulo: captura" },
  "/produccion/balken": { admin: "todo", produccion: "captura lotes y remisiones" },
  "/produccion/carpinteria": { admin: "todo", produccion: "captura lotes y remisiones" },
  "/clavicon": { admin: "consulta" },
  "/admin": { admin: "usuarios, roles, entidades, reglas" },
  "/organigrama/configurar": { admin: "edita" },
  "/guia": {},
};

function perfilDeMuestra(rol: AppRol, modulos: string[]): Profile {
  const veTodas = rol === "admin" || rol === "corporativo" || rol === "direccion";
  return { id: "muestra", nombre: "", rol, grupo_id: "g", empresa_id: veTodas ? null : "e", todas_las_empresas: veTodas, activo: true, telefono: null, bbva_mantenimiento: false, espectador: false, rh_nivel: null, modulos };
}

export interface AccesoRuta {
  ruta: string;
  etiqueta: string;
  seccion: string;
  /** Solo con módulo asignado por RH (roles básicos). */
  conModulo: boolean;
  edita: string | null;
}

/** Rutas que ve un rol: con sus módulos base y, aparte, las que solo ve si
 * RH le asigna un módulo. */
export function accesosDelRol(rol: AppRol): AccesoRuta[] {
  const base = perfilDeMuestra(rol, esRolBasico(rol) ? [...MODULOS_BASE] : []);
  const todos = perfilDeMuestra(rol, esRolBasico(rol) ? [...MODULOS_BASE, ...MODULOS_ASIGNABLES.map((m) => m.clave)] : []);
  const lista: AccesoRuta[] = [];
  for (const s of SECCIONES) {
    for (const e of s.entradas) {
      const veBase = e.visible(base);
      const veConModulo = !veBase && e.visible(todos);
      if (!veBase && !veConModulo) continue;
      lista.push({ ruta: e.ruta, etiqueta: e.etiqueta, seccion: s.titulo, conModulo: veConModulo, edita: EDITA[e.ruta]?.[rol] ?? null });
    }
  }
  return lista;
}

export function esRolPersonal(rol: AppRol): boolean {
  return (ROLES_BASICOS as string[]).includes(rol);
}
