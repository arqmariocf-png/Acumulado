// Reportes de las áreas para el director general (5-nov-2026, Mario: "así
// como generaste el reporte del área de recursos humanos, haz el de todas las
// áreas para revisarlos e irlos puliendo"). Mismo molde que el de RH: la base
// (`fn_reporte_area_director(area, dias)`) entrega un jsonb con indicadores y
// listas; aquí vive la configuración de cada área (qué indicador se muestra,
// cómo se formatea, su semáforo, a qué pantalla liga, qué listas lleva), las
// reglas de alertas y el resumen ejecutivo. Puro, sin DOM: se prueba en node.
// Primera versión para revisar con Mario: los umbrales y las listas se afinan
// aquí, no en la base.

import type { DefinicionRenglon } from "./historicoRh.ts";

export type AreaReporte = "finanzas" | "contabilidad" | "comercial" | "operacion" | "compras" | "mantenimiento" | "produccion" | "legal";
export const LISTA_AREAS: AreaReporte[] = ["finanzas", "contabilidad", "comercial", "operacion", "compras", "mantenimiento", "produccion", "legal"];

export type Semaforo = "verde" | "ambar" | "rojo" | "gris";
export type Formato = "n" | "money" | "pct" | "fecha" | "texto" | "dias";
export type Indicadores = Record<string, number | null>;

export interface ReporteArea {
  area: AreaReporte;
  desde: string;
  hasta: string;
  dias: number;
  indicadores: Indicadores;
  secciones: Record<string, unknown>;
}

export interface IndicadorDef {
  clave: string;
  etiqueta: string;
  formato: "n" | "money" | "pct";
  /** Si subir es bueno (ventas) o malo (vencidos); para la evolución. */
  masEsMejor?: boolean;
  /** Semáforo a partir del valor y del resto de indicadores. */
  semaforo?: (v: number | null, ind: Indicadores) => Semaforo;
  /** Va en las tarjetas grandes del resumen ejecutivo (máximo 8 por área). */
  destacado?: boolean;
  /** Texto chico bajo la cifra. */
  sub?: (ind: Indicadores) => string;
  /** A dónde lleva la cifra para corroborarla. */
  liga?: string;
}

export interface ColumnaDef {
  clave: string;
  etiqueta: string;
  formato?: Formato;
}

export interface SeccionDef {
  clave: string;
  titulo: string;
  columnas: ColumnaDef[];
  liga?: string;
  nota?: string;
  /** Si viene, la presentación la pinta como barras (etiqueta, valor). */
  barras?: { etiqueta: string; valor: string };
}

export interface AlertaArea {
  nivel: "rojo" | "ambar";
  texto: string;
  ruta: string;
}

export interface ConfigArea {
  clave: AreaReporte;
  titulo: string;
  /** Lo que cubre, para la portada. */
  cubre: string;
  /** Pantalla principal del área. */
  ruta: string;
  indicadores: IndicadorDef[];
  secciones: SeccionDef[];
  alertas: (d: ReporteArea) => AlertaArea[];
  resumen: (d: ReporteArea) => string[];
  /** Lo que todavía hay que validar con el área (lámina final). */
  porRevisar: string[];
}

// ---- formato y semáforos ----
export const n0 = (n: number | null | undefined) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("es-MX"));
export const moneda = (n: number | null | undefined) => (n == null ? "—" : `$ ${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(Number(n))} %`);
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

export function formatear(v: unknown, formato: Formato = "texto"): string {
  if (v == null || v === "") return "—";
  if (formato === "n") return n0(Number(v));
  if (formato === "money") return moneda(Number(v));
  if (formato === "pct") return pct(Number(v));
  if (formato === "dias") return `${n0(Number(v))} d`;
  if (formato === "fecha") return ddmm(String(v));
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

/** Verde si no hay nada; ámbar hasta `tope`; rojo arriba. */
export const semN = (tope: number) => (v: number | null): Semaforo => (v == null ? "gris" : v <= 0 ? "verde" : v <= tope ? "ambar" : "rojo");
/** Verde ≥ bueno, ámbar ≥ regular, rojo abajo. */
export const semPct = (bueno: number, regular: number) => (v: number | null): Semaforo => (v == null ? "gris" : v >= bueno ? "verde" : v >= regular ? "ambar" : "rojo");

export function semaforoDe(def: IndicadorDef, ind: Indicadores): Semaforo {
  const v = ind[def.clave] ?? null;
  return def.semaforo ? def.semaforo(v, ind) : "gris";
}

export function valorIndicador(def: IndicadorDef, ind: Indicadores): string {
  return formatear(ind[def.clave], def.formato);
}

/** Filas de una sección como arreglo de objetos (la base manda jsonb). */
export function filasSeccion(d: ReporteArea, clave: string): Record<string, unknown>[] {
  const x = d.secciones?.[clave];
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}

const num = (ind: Indicadores, k: string) => Number(ind[k] ?? 0);

// ---- Configuración por área ----
export const AREAS_REPORTE: Record<AreaReporte, ConfigArea> = {
  finanzas: {
    clave: "finanzas",
    titulo: "Finanzas",
    cubre: "saldos bancarios · pagos programados · órdenes por pagar · cuentas por pagar · deuda financiera · conciliación",
    ruta: "/finanzas/pagos",
    indicadores: [
      { clave: "saldo_bancos", etiqueta: "Saldo en bancos (último estado de cuenta)", formato: "money", destacado: true, sub: (i) => `${n0(i.cuentas_activas)} cuentas · ${n0(i.cuentas_sin_estado_7d)} sin estado de cuenta reciente`, liga: "/finanzas/saldos", semaforo: (_v, i) => semN(0)(i.cuentas_sin_estado_7d ?? null) },
      { clave: "pagos_vencidos_monto", etiqueta: "Pagos programados vencidos", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.pagos_vencidos)} pagos`, liga: "/finanzas/pagos#pagos-vencidos", semaforo: (_v, i) => semN(0)(i.pagos_vencidos ?? null) },
      { clave: "pagos_7d_monto", etiqueta: "Pagos de los próximos 7 días", formato: "money", destacado: true, sub: (i) => `${n0(i.pagos_7d)} pagos`, liga: "/finanzas/pagos#pagos-semana" },
      { clave: "pagados_periodo_monto", etiqueta: "Pagado en el periodo", formato: "money", destacado: true, sub: (i) => `${n0(i.pagados_periodo)} pagos · ${pct(i.pct_sin_comprobante)} sin comprobante`, liga: "/finanzas/historial-pagos", semaforo: (_v, i) => (i.pct_sin_comprobante == null ? "gris" : i.pct_sin_comprobante >= 20 ? "rojo" : i.pct_sin_comprobante >= 1 ? "ambar" : "verde") },
      { clave: "oc_con_saldo_monto", etiqueta: "OC/OS con saldo por pagar", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.oc_con_saldo)} órdenes · ${n0(i.oc_vencidas)} vencidas (${moneda(i.oc_vencidas_monto)})`, liga: "/finanzas/pagos", semaforo: (_v, i) => semN(5)(i.oc_vencidas ?? null) },
      { clave: "oc_por_autorizar_monto", etiqueta: "Órdenes por autorizar", formato: "money", masEsMejor: false, sub: (i) => `${n0(i.oc_por_autorizar)} órdenes`, liga: "/finanzas/por-autorizar", semaforo: (_v, i) => semN(10)(i.oc_por_autorizar ?? null) },
      { clave: "cxp_deuda", etiqueta: "Se debe a proveedores con línea", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.cxp_proveedores)} proveedores · líneas ${moneda(i.cxp_lineas)} · ${n0(i.cxp_rojos)} en rojo`, liga: "/finanzas/proveedores", semaforo: (_v, i) => semN(0)(i.cxp_rojos ?? null) },
      { clave: "deuda_financiera", etiqueta: "Deuda financiera (saldo MXN)", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.deuda_creditos)} créditos · ${moneda(i.prestamos_30d)} a pagar en 30 días`, liga: "/finanzas/deuda" },
      { clave: "conciliados_pct", etiqueta: "Movimientos conciliados del periodo", formato: "pct", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.movimientos_periodo)} movimientos · ${n0(i.en_revision)} en revisión`, liga: "/movimientos?ver=revisar", semaforo: semPct(85, 60) },
      { clave: "gastos_por_revisar", etiqueta: "Comprobaciones de gasto por revisar", formato: "n", masEsMejor: false, liga: "/gastos#por-revisar", semaforo: semN(5) },
    ],
    secciones: [
      { clave: "saldos_por_empresa", titulo: "Saldo en bancos por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "cuentas", etiqueta: "Cuentas", formato: "n" }, { clave: "saldo", etiqueta: "Saldo", formato: "money" }, { clave: "al", etiqueta: "Estado de cuenta al", formato: "fecha" }], liga: "/finanzas/saldos", barras: { etiqueta: "empresa", valor: "saldo" }, nota: "Saldo del último movimiento cargado de cada cuenta activa más el ajuste capturado." },
      { clave: "pagos_vencidos", titulo: "Pagos programados vencidos", columnas: [{ clave: "fecha", etiqueta: "Programado", formato: "fecha" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "beneficiario", etiqueta: "Beneficiario" }, { clave: "tipo", etiqueta: "Tipo" }, { clave: "metodo", etiqueta: "Método" }, { clave: "monto", etiqueta: "Monto", formato: "money" }], liga: "/finanzas/pagos#pagos-vencidos" },
      { clave: "cxp_top", titulo: "Cuentas por pagar: proveedores con línea", columnas: [{ clave: "proveedor", etiqueta: "Proveedor" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "deuda", etiqueta: "Se debe", formato: "money" }, { clave: "linea", etiqueta: "Línea", formato: "money" }, { clave: "pct", etiqueta: "Uso", formato: "pct" }], liga: "/finanzas/proveedores", barras: { etiqueta: "proveedor", valor: "deuda" } },
      { clave: "oc_por_autorizar", titulo: "Órdenes por autorizar (mayores)", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "tipo", etiqueta: "Tipo" }, { clave: "folio", etiqueta: "Folio" }, { clave: "proveedor", etiqueta: "Proveedor" }, { clave: "fecha", etiqueta: "Fecha", formato: "fecha" }, { clave: "saldo", etiqueta: "Saldo", formato: "money" }], liga: "/finanzas/por-autorizar" },
      { clave: "deuda_creditos", titulo: "Deuda financiera por crédito", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "acreedor", etiqueta: "Acreedor" }, { clave: "saldo", etiqueta: "Saldo", formato: "money" }, { clave: "moneda", etiqueta: "Moneda" }, { clave: "tasa", etiqueta: "Tasa", formato: "pct" }, { clave: "vence", etiqueta: "Vence", formato: "fecha" }], liga: "/finanzas/deuda" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "pagos_vencidos") > 0) a.push({ nivel: "rojo", texto: `${n0(i.pagos_vencidos)} pago(s) programado(s) ya vencieron por ${moneda(i.pagos_vencidos_monto)}.`, ruta: "/finanzas/pagos#pagos-vencidos" });
      if (num(i, "cxp_rojos") > 0) a.push({ nivel: "rojo", texto: `${n0(i.cxp_rojos)} proveedor(es) con la línea de crédito rebasada.`, ruta: "/finanzas/proveedores" });
      if (num(i, "oc_vencidas") > 0) a.push({ nivel: num(i, "oc_vencidas") > 5 ? "rojo" : "ambar", texto: `${n0(i.oc_vencidas)} OC/OS a crédito vencidas sin pagar por ${moneda(i.oc_vencidas_monto)}.`, ruta: "/finanzas/pagos" });
      if (num(i, "cuentas_sin_estado_7d") > 0) a.push({ nivel: "ambar", texto: `${n0(i.cuentas_sin_estado_7d)} cuenta(s) bancaria(s) sin estado de cuenta de la última semana: el saldo y la hoja de pagos van atrasados.`, ruta: "/carga" });
      if ((i.pct_sin_comprobante ?? 0) >= 1) a.push({ nivel: (i.pct_sin_comprobante ?? 0) >= 20 ? "rojo" : "ambar", texto: `${pct(i.pct_sin_comprobante)} de los pagos del periodo (${n0(i.pagos_sin_comprobante)}) no tienen comprobante.`, ruta: "/finanzas/tesoreria#sin-comprobante" });
      if (num(i, "oc_por_autorizar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.oc_por_autorizar)} orden(es) esperando autorización por ${moneda(i.oc_por_autorizar_monto)}.`, ruta: "/finanzas/por-autorizar" });
      if ((i.conciliados_pct ?? 100) < 70) a.push({ nivel: "ambar", texto: `Solo ${pct(i.conciliados_pct)} de los ${n0(i.movimientos_periodo)} movimientos bancarios del periodo están conciliados (${n0(i.en_revision)} en revisión).`, ruta: "/movimientos?ver=revisar" });
      if (num(i, "gastos_por_revisar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.gastos_por_revisar)} comprobación(es) de gasto por revisar.`, ruta: "/gastos#por-revisar" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Saldo en bancos ${moneda(i.saldo_bancos)} en ${n0(i.cuentas_activas)} cuentas; se pagaron ${moneda(i.pagados_periodo_monto)} en ${n0(i.pagados_periodo)} pagos en el periodo.`,
        `Por pagar: ${moneda(i.oc_con_saldo_monto)} en ${n0(i.oc_con_saldo)} OC/OS con saldo (${n0(i.oc_vencidas)} vencidas); ${n0(i.pagos_vencidos)} pagos programados vencidos por ${moneda(i.pagos_vencidos_monto)} y ${moneda(i.pagos_7d_monto)} programados para los próximos 7 días.`,
        `Cuentas por pagar a proveedores con línea: ${moneda(i.cxp_deuda)} contra líneas por ${moneda(i.cxp_lineas)} (${n0(i.cxp_rojos)} en rojo). Deuda financiera: ${moneda(i.deuda_financiera)} en ${n0(i.deuda_creditos)} créditos.`,
        `Conciliación: ${pct(i.conciliados_pct)} de ${n0(i.movimientos_periodo)} movimientos del periodo conciliados; ${n0(i.en_revision)} en revisión.`,
      ];
    },
    porRevisar: [
      "Si el saldo en bancos debe salir del último estado de cuenta (como hoy) o del saldo del día de la hoja de pagos.",
      "Umbral de 'OC vencidas': hoy cuenta fecha de OC + días de crédito del proveedor; confirmar con Laura.",
      "Qué cuentas bancarias ya no se usan y deben marcarse inactivas para no salir como 'sin estado de cuenta'.",
      "Agregar la deuda intercompañía (préstamos entre empresas) cuando se capture la contraparte en los movimientos.",
    ],
  },
  contabilidad: {
    clave: "contabilidad",
    titulo: "Contabilidad",
    cubre: "CFDI del SAT · conciliación bancaria · estados de cuenta · remisiones por facturar · e.firmas",
    ruta: "/contabilidad/efirmas-sat",
    indicadores: [
      { clave: "cfdi_emitidos_monto", etiqueta: "Facturado (CFDI emitidos del periodo)", formato: "money", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.cfdi_emitidos)} facturas de ingreso`, liga: "/perfil-fiscal" },
      { clave: "cfdi_recibidos_monto", etiqueta: "Recibido (CFDI recibidos del periodo)", formato: "money", destacado: true, sub: (i) => `${n0(i.cfdi_recibidos)} facturas · ${n0(i.complementos_periodo)} complementos de pago`, liga: "/perfil-fiscal" },
      { clave: "sat_al_dia", etiqueta: "Empresas con el SAT al día", formato: "n", destacado: true, masEsMejor: true, sub: (i) => `de ${n0(i.empresas)} · ${n0(i.sat_atrasadas)} atrasadas · ${n0(i.sat_con_error)} con error`, liga: "/contabilidad/efirmas-sat", semaforo: (_v, i) => semN(0)(i.sat_atrasadas ?? null) },
      { clave: "efirmas", etiqueta: "e.firmas cargadas", formato: "n", sub: (i) => `de ${n0(i.empresas)} empresas`, liga: "/contabilidad/efirmas-sat", semaforo: (v, i) => (v == null ? "gris" : v >= num(i, "empresas") ? "verde" : "ambar") },
      { clave: "conciliados_pct", etiqueta: "Movimientos conciliados del periodo", formato: "pct", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.conciliados)} de ${n0(i.movimientos_periodo)}`, liga: "/movimientos", semaforo: semPct(85, 60) },
      { clave: "en_revision", etiqueta: "En revisión", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.ambiguos)} ambiguos · ${n0(i.esperando_factura)} esperando factura`, liga: "/movimientos?ver=revisar", semaforo: semN(50) },
      { clave: "duplicados", etiqueta: "Posibles duplicados", formato: "n", masEsMejor: false, liga: "/movimientos?ver=duplicados", semaforo: semN(20) },
      { clave: "estados_cuenta_cargados", etiqueta: "Estados de cuenta cargados en el periodo", formato: "n", destacado: true, sub: (i) => `${n0(i.cuentas_sin_estado_7d)} cuentas sin estado reciente`, liga: "/carga", semaforo: (_v, i) => semN(0)(i.cuentas_sin_estado_7d ?? null) },
      { clave: "remisiones_por_facturar", etiqueta: "Remisiones por facturar", formato: "n", destacado: true, masEsMejor: false, liga: "/contabilidad/remisiones", semaforo: semN(10) },
    ],
    secciones: [
      { clave: "por_empresa", titulo: "Por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "emitidos", etiqueta: "Emitidos", formato: "n" }, { clave: "emitidos_monto", etiqueta: "Facturado", formato: "money" }, { clave: "recibidos", etiqueta: "Recibidos", formato: "n" }, { clave: "recibidos_monto", etiqueta: "Recibido", formato: "money" }, { clave: "movimientos", etiqueta: "Mov. banco", formato: "n" }, { clave: "conciliados_pct", etiqueta: "Conciliado", formato: "pct" }, { clave: "ultimo_estado", etiqueta: "Edo. cuenta al", formato: "fecha" }], liga: "/perfil-fiscal", barras: { etiqueta: "empresa", valor: "emitidos_monto" } },
      { clave: "sat_por_empresa", titulo: "Descarga del SAT por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "hasta", etiqueta: "CFDI al día hasta", formato: "fecha" }, { clave: "atrasada", etiqueta: "Atrasada" }, { clave: "error", etiqueta: "Error del SAT" }], liga: "/contabilidad/efirmas-sat", nota: "Al día = emitidos y recibidos descargados hasta hace 2 días o menos." },
      { clave: "remisiones_por_facturar", titulo: "Remisiones por facturar (más antiguas)", columnas: [{ clave: "fecha", etiqueta: "Fecha", formato: "fecha" }, { clave: "origen", etiqueta: "Origen" }, { clave: "folio", etiqueta: "Folio" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "contraparte", etiqueta: "Cliente" }], liga: "/contabilidad/remisiones" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "sat_con_error") > 0) a.push({ nivel: "rojo", texto: `${n0(i.sat_con_error)} empresa(s) con error del SAT en la descarga (e.firma rechazada o solicitud fallida).`, ruta: "/contabilidad/efirmas-sat" });
      if (num(i, "sat_atrasadas") > 0) a.push({ nivel: "ambar", texto: `${n0(i.sat_atrasadas)} de ${n0(i.empresas)} empresas con la descarga del SAT atrasada más de 2 días.`, ruta: "/contabilidad/efirmas-sat" });
      if (num(i, "efirmas") < num(i, "empresas")) a.push({ nivel: "ambar", texto: `${n0(num(i, "empresas") - num(i, "efirmas"))} empresa(s) sin e.firma cargada: no se descargan sus CFDI.`, ruta: "/contabilidad/efirmas-sat" });
      if ((i.conciliados_pct ?? 100) < 70) a.push({ nivel: (i.conciliados_pct ?? 100) < 50 ? "rojo" : "ambar", texto: `Conciliación al ${pct(i.conciliados_pct)}: ${n0(i.en_revision)} movimientos en revisión, ${n0(i.ambiguos)} ambiguos y ${n0(i.esperando_factura)} esperando factura.`, ruta: "/movimientos?ver=revisar" });
      if (num(i, "duplicados") > 0) a.push({ nivel: "ambar", texto: `${n0(i.duplicados)} movimientos marcados como posible duplicado.`, ruta: "/movimientos?ver=duplicados" });
      if (num(i, "cuentas_sin_estado_7d") > 0) a.push({ nivel: "ambar", texto: `${n0(i.cuentas_sin_estado_7d)} cuenta(s) sin estado de cuenta de la última semana.`, ruta: "/carga" });
      if (num(i, "remisiones_por_facturar") > 0) a.push({ nivel: num(i, "remisiones_por_facturar") > 10 ? "rojo" : "ambar", texto: `${n0(i.remisiones_por_facturar)} remisiones entregadas sin facturar.`, ruta: "/contabilidad/remisiones" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Facturado ${moneda(i.cfdi_emitidos_monto)} en ${n0(i.cfdi_emitidos)} CFDI emitidos; recibido ${moneda(i.cfdi_recibidos_monto)} en ${n0(i.cfdi_recibidos)} CFDI (${n0(i.complementos_periodo)} complementos de pago).`,
        `SAT: ${n0(i.sat_al_dia)} de ${n0(i.empresas)} empresas al día; ${n0(i.efirmas)} e.firmas cargadas.`,
        `Conciliación bancaria del periodo: ${n0(i.conciliados)} de ${n0(i.movimientos_periodo)} movimientos (${pct(i.conciliados_pct)}); ${n0(i.en_revision)} en revisión, ${n0(i.ambiguos)} ambiguos, ${n0(i.esperando_factura)} esperando factura, ${n0(i.duplicados)} posibles duplicados.`,
        `${n0(i.estados_cuenta_cargados)} estados de cuenta cargados en el periodo; ${n0(i.remisiones_por_facturar)} remisiones por facturar.`,
      ];
    },
    porRevisar: [
      "Si 'al día' del SAT debe ser 2 días (hoy) o más, porque el SAT libera lo de hoy mañana.",
      "Meta de conciliación por empresa (hoy el semáforo es verde ≥ 85 %, ámbar ≥ 60 %).",
      "Separar en el facturado las ventas entre empresas del grupo de las ventas a terceros.",
      "Qué CFDI de nómina (tipo N) y de traslado (T) deben verse aquí; hoy quedan fuera.",
    ],
  },
  comercial: {
    clave: "comercial",
    titulo: "Comercial",
    cubre: "órdenes de venta · cuentas por cobrar · CRM · cotizaciones · punto de venta",
    ruta: "/finanzas/cobranza",
    indicadores: [
      { clave: "ov_periodo_monto", etiqueta: "Ventas del periodo (OV)", formato: "money", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.ov_periodo)} órdenes · ${n0(i.ov_clientes)} clientes`, liga: "/ordenes?tipo=OV&backoffice=1" },
      { clave: "cxc_saldo", etiqueta: "Cuentas por cobrar (externos)", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.cxc_documentos)} documentos · ${n0(i.cxc_clientes)} clientes`, liga: "/finanzas/cobranza?vista=cartera" },
      { clave: "cxc_vencido", etiqueta: "Vencido por cobrar", formato: "money", destacado: true, masEsMejor: false, liga: "/finanzas/cobranza?vista=agenda", semaforo: (v, i) => (v == null ? "gris" : v <= 0 ? "verde" : v > num(i, "cxc_saldo") * 0.3 ? "rojo" : "ambar") },
      { clave: "cxc_grupo", etiqueta: "Por cobrar entre empresas del grupo", formato: "money", destacado: true, liga: "/finanzas/cobranza?vista=entre" },
      { clave: "crm_abiertos", etiqueta: "Prospectos abiertos (CRM)", formato: "n", destacado: true, sub: (i) => `${n0(i.crm_nuevos_periodo)} nuevos · ${n0(i.crm_ganados_periodo)} ganados · ${n0(i.crm_sin_respuesta)} sin respuesta`, liga: "/ventas/crm", semaforo: (_v, i) => semN(0)(i.crm_sin_respuesta ?? null) },
      { clave: "cotizaciones_periodo", etiqueta: "Cotizaciones del periodo", formato: "n", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.cotizaciones_convertidas)} convertidas en OV`, liga: "/cotizador" },
      { clave: "pv_monto", etiqueta: "Punto de venta (mostrador)", formato: "money", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.pv_ventas)} tickets · utilidad ${moneda(i.pv_utilidad)} · ${n0(i.pv_por_entregar)} por entregar`, liga: "/punto-venta" },
    ],
    secciones: [
      { clave: "ov_por_empresa", titulo: "Ventas por empresa (OV del periodo)", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "n", etiqueta: "OV", formato: "n" }, { clave: "monto", etiqueta: "Monto", formato: "money" }], liga: "/ordenes?tipo=OV&backoffice=1", barras: { etiqueta: "empresa", valor: "monto" } },
      { clave: "ov_top_clientes", titulo: "Clientes con más venta en el periodo", columnas: [{ clave: "cliente", etiqueta: "Cliente" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "n", etiqueta: "OV", formato: "n" }, { clave: "monto", etiqueta: "Monto", formato: "money" }], liga: "/ordenes?tipo=OV&backoffice=1" },
      { clave: "cxc_top_clientes", titulo: "Cuentas por cobrar por cliente (externos)", columnas: [{ clave: "cliente", etiqueta: "Cliente" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "documentos", etiqueta: "Docs", formato: "n" }, { clave: "saldo", etiqueta: "Saldo", formato: "money" }, { clave: "vencido", etiqueta: "Vencido", formato: "money" }], liga: "/finanzas/cobranza?vista=cartera", barras: { etiqueta: "cliente", valor: "saldo" } },
      { clave: "cotizaciones", titulo: "Cotizaciones recientes", columnas: [{ clave: "fecha", etiqueta: "Fecha", formato: "fecha" }, { clave: "folio", etiqueta: "Folio" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "cliente", etiqueta: "Cliente" }, { clave: "estatus", etiqueta: "Estatus" }, { clave: "convertida", etiqueta: "En OV" }], liga: "/cotizador" },
      { clave: "crm_por_etapa", titulo: "CRM por etapa", columnas: [{ clave: "etapa", etiqueta: "Etapa" }, { clave: "n", etiqueta: "Prospectos", formato: "n" }], liga: "/ventas/crm" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "cxc_vencido") > 0) a.push({ nivel: num(i, "cxc_vencido") > num(i, "cxc_saldo") * 0.3 ? "rojo" : "ambar", texto: `${moneda(i.cxc_vencido)} de cuentas por cobrar ya vencidas (${pct((100 * num(i, "cxc_vencido")) / Math.max(1, num(i, "cxc_saldo")))} de la cartera externa).`, ruta: "/finanzas/cobranza?vista=agenda" });
      if (num(i, "crm_sin_respuesta") > 0) a.push({ nivel: "rojo", texto: `${n0(i.crm_sin_respuesta)} prospecto(s) del CRM llevan más de 2 horas esperando respuesta.`, ruta: "/ventas/crm" });
      if (num(i, "cotizaciones_periodo") > 0 && num(i, "cotizaciones_convertidas") === 0) a.push({ nivel: "ambar", texto: `Ninguna de las ${n0(i.cotizaciones_periodo)} cotizaciones del periodo se ha convertido en orden de venta.`, ruta: "/cotizador" });
      if (num(i, "pv_por_entregar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.pv_por_entregar)} venta(s) de mostrador con mercancía por entregar.`, ruta: "/punto-venta" });
      if (num(i, "cxc_grupo") > 0) a.push({ nivel: "ambar", texto: `${moneda(i.cxc_grupo)} por cobrar entre empresas del grupo (no es cartera externa).`, ruta: "/finanzas/cobranza?vista=entre" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Ventas: ${n0(i.ov_periodo)} órdenes de venta por ${moneda(i.ov_periodo_monto)} a ${n0(i.ov_clientes)} clientes en el periodo.`,
        `Cuentas por cobrar externas: ${moneda(i.cxc_saldo)} en ${n0(i.cxc_documentos)} documentos de ${n0(i.cxc_clientes)} clientes; vencido ${moneda(i.cxc_vencido)}. Entre empresas del grupo: ${moneda(i.cxc_grupo)}.`,
        `CRM: ${n0(i.crm_abiertos)} prospectos abiertos (${n0(i.crm_nuevos_periodo)} nuevos, ${n0(i.crm_ganados_periodo)} ganados); ${n0(i.cotizaciones_periodo)} cotizaciones, ${n0(i.cotizaciones_convertidas)} convertidas.`,
        `Mostrador: ${n0(i.pv_ventas)} tickets por ${moneda(i.pv_monto)} con utilidad de ${moneda(i.pv_utilidad)}.`,
      ];
    },
    porRevisar: [
      "Las OV del backoffice incluyen ventas entre empresas del grupo: definir si 'ventas' las cuenta o solo a terceros.",
      "El CRM y el punto de venta aún no tienen operación: los ceros son reales, no un error.",
      "Las cotizaciones de planta y las del cotizador general se cuentan juntas.",
      "Meta de cartera vencida (hoy rojo si pasa del 30 % de la cartera externa).",
    ],
  },
  operacion: {
    clave: "operacion",
    titulo: "Operación (obras)",
    cubre: "obras activas · gasto real contra presupuesto · tareas de obra · requerimientos",
    ruta: "/finanzas/obras",
    indicadores: [
      { clave: "obras_activas", etiqueta: "Obras activas", formato: "n", destacado: true, sub: (i) => `${n0(i.obras_con_gasto)} con gasto · ${n0(i.obras_con_presupuesto)} con presupuesto`, liga: "/proyectos" },
      { clave: "gasto_periodo", etiqueta: "Gasto del periodo (OC/OS, mano de obra y control)", formato: "money", destacado: true, masEsMejor: false, sub: () => "s/IVA, por mes de emisión", liga: "/finanzas/avance-financiero?vista=periodo" },
      { clave: "real_total", etiqueta: "Ejercido acumulado en obras activas", formato: "money", destacado: true, sub: (i) => `presupuesto ${moneda(i.presupuesto_total)} · pendiente de pago ${moneda(i.pendiente_pago)}`, liga: "/finanzas/avance-financiero" },
      { clave: "obras_rebasadas", etiqueta: "Obras con presupuesto rebasado", formato: "n", destacado: true, masEsMejor: false, liga: "/finanzas/avance-financiero?vista=obra", semaforo: semN(0) },
      { clave: "obras_con_presupuesto", etiqueta: "Obras con presupuesto capturado", formato: "n", masEsMejor: true, sub: (i) => `de ${n0(i.obras_activas)} activas`, liga: "/finanzas/avance-financiero?vista=capturar", semaforo: (v, i) => (v == null ? "gris" : v >= num(i, "obras_con_gasto") ? "verde" : v > 0 ? "ambar" : "rojo") },
      { clave: "tareas_obra_vencidas", etiqueta: "Tareas de obra vencidas", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.tareas_obra_abiertas)} abiertas · ${n0(i.tareas_hechas_periodo)} hechas en el periodo`, liga: "/tareas/area/operacion", semaforo: semN(5) },
      { clave: "requisiciones_abiertas", etiqueta: "Requerimientos abiertos", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.requisiciones_sin_resolver)} sin resolver · ${n0(i.requisiciones_periodo)} nuevos en el periodo`, liga: "/requisiciones?ver=sin_resolver", semaforo: (_v, i) => semN(5)(i.requisiciones_sin_resolver ?? null) },
    ],
    secciones: [
      { clave: "obras_top_gasto", titulo: "Obras con más gasto en el periodo", columnas: [{ clave: "obra", etiqueta: "Obra" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "gasto_periodo", etiqueta: "Periodo", formato: "money" }, { clave: "real_total", etiqueta: "Acumulado", formato: "money" }, { clave: "presupuesto", etiqueta: "Presupuesto", formato: "money" }, { clave: "pct", etiqueta: "Ejercido", formato: "pct" }], liga: "/finanzas/avance-financiero?vista=obra", barras: { etiqueta: "obra", valor: "gasto_periodo" } },
      { clave: "gasto_por_empresa", titulo: "Gasto de obras por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "obras", etiqueta: "Obras", formato: "n" }, { clave: "gasto_periodo", etiqueta: "Periodo", formato: "money" }, { clave: "real_total", etiqueta: "Acumulado", formato: "money" }, { clave: "presupuesto", etiqueta: "Presupuesto", formato: "money" }], liga: "/finanzas/avance-financiero?vista=empresa" },
      { clave: "obras_rebasadas", titulo: "Obras con presupuesto rebasado", columnas: [{ clave: "obra", etiqueta: "Obra" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "presupuesto", etiqueta: "Presupuesto", formato: "money" }, { clave: "real_total", etiqueta: "Ejercido", formato: "money" }, { clave: "exceso", etiqueta: "Exceso", formato: "money" }], liga: "/finanzas/avance-financiero?vista=obra" },
      { clave: "tareas_vencidas_por_obra", titulo: "Tareas vencidas por obra", columnas: [{ clave: "obra", etiqueta: "Obra" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "vencidas", etiqueta: "Vencidas", formato: "n" }], liga: "/tareas/area/operacion" },
      { clave: "requisiciones_por_etapa", titulo: "Requerimientos abiertos por etapa", columnas: [{ clave: "etapa", etiqueta: "Etapa" }, { clave: "n", etiqueta: "Requerimientos", formato: "n" }], liga: "/requisiciones" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "obras_rebasadas") > 0) a.push({ nivel: "rojo", texto: `${n0(i.obras_rebasadas)} obra(s) ya gastaron más que su presupuesto.`, ruta: "/finanzas/avance-financiero?vista=obra" });
      if (num(i, "tareas_obra_vencidas") > 0) a.push({ nivel: num(i, "tareas_obra_vencidas") > 5 ? "rojo" : "ambar", texto: `${n0(i.tareas_obra_vencidas)} tarea(s) de obra vencidas sin terminar.`, ruta: "/tareas/area/operacion" });
      if (num(i, "requisiciones_sin_resolver") > 0) a.push({ nivel: num(i, "requisiciones_sin_resolver") > 5 ? "rojo" : "ambar", texto: `${n0(i.requisiciones_sin_resolver)} requerimiento(s) de obra sin resolver por compras.`, ruta: "/requisiciones?ver=sin_resolver" });
      if (num(i, "obras_con_gasto") > num(i, "obras_con_presupuesto")) a.push({ nivel: "ambar", texto: `${n0(num(i, "obras_con_gasto") - num(i, "obras_con_presupuesto"))} obra(s) con gasto no tienen presupuesto capturado: no se puede medir su desfase.`, ruta: "/finanzas/avance-financiero?vista=capturar" });
      if (num(i, "pendiente_pago") > 0) a.push({ nivel: "ambar", texto: `${moneda(i.pendiente_pago)} del gasto de obras sigue pendiente de pago.`, ruta: "/finanzas/avance-financiero" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `${n0(i.obras_activas)} obras activas; ${n0(i.obras_con_gasto)} con gasto registrado y solo ${n0(i.obras_con_presupuesto)} con presupuesto capturado.`,
        `Gasto del periodo ${moneda(i.gasto_periodo)}; ejercido acumulado ${moneda(i.real_total)} contra presupuesto ${moneda(i.presupuesto_total)}; pendiente de pago ${moneda(i.pendiente_pago)}.`,
        `Tareas de obra: ${n0(i.tareas_obra_abiertas)} abiertas, ${n0(i.tareas_obra_vencidas)} vencidas, ${n0(i.tareas_hechas_periodo)} terminadas en el periodo.`,
        `Requerimientos: ${n0(i.requisiciones_periodo)} nuevos en el periodo, ${n0(i.requisiciones_abiertas)} abiertos (${n0(i.requisiciones_sin_resolver)} sin resolver).`,
      ];
    },
    porRevisar: [
      "El 'gasto del periodo' va por mes de emisión de la OC (como el avance financiero), no por día.",
      "Qué obras activas ya terminaron y deben desactivarse para no inflar la lista.",
      "Capturar presupuesto por categoría a las obras con gasto para que el semáforo de desfase signifique algo.",
      "Agregar el avance físico (tareas, suministro, PU) por obra como en el resumen de obras.",
    ],
  },
  compras: {
    clave: "compras",
    titulo: "Compras y almacén",
    cubre: "órdenes de compra y de servicio · proveedores · requerimientos · inventario · herramienta",
    ruta: "/ordenes",
    indicadores: [
      { clave: "oc_periodo_monto", etiqueta: "Comprado en el periodo (OC/OS s/IVA)", formato: "money", destacado: true, sub: (i) => `${n0(i.oc_periodo)} órdenes (${n0(i.os_periodo)} de servicio) · ${n0(i.proveedores_periodo)} proveedores`, liga: "/ordenes?tipo=OC&backoffice=1" },
      { clave: "oc_backoffice", etiqueta: "Órdenes del backoffice", formato: "n", destacado: true, sub: (i) => `${n0(i.oc_acumulado)} capturadas en Acumulado`, liga: "/ordenes?tipo=OC&backoffice=1" },
      { clave: "oc_por_autorizar", etiqueta: "Órdenes del periodo sin autorizar", formato: "n", masEsMejor: false, liga: "/finanzas/por-autorizar", semaforo: semN(10) },
      { clave: "requisiciones_sin_resolver", etiqueta: "Requerimientos sin resolver", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.requisiciones_periodo)} nuevos · ${n0(i.requisiciones_en_camino)} en bodega o en camino`, liga: "/requisiciones?ver=sin_resolver", semaforo: semN(5) },
      { clave: "valor_inventario", etiqueta: "Valor del inventario", formato: "money", destacado: true, sub: (i) => `${n0(i.productos)} productos · ${n0(i.con_existencia)} con existencia`, liga: "/inventario/resumen" },
      { clave: "existencias_negativas", etiqueta: "Existencias negativas", formato: "n", destacado: true, masEsMejor: false, liga: "/inventario/existencias", semaforo: semN(0) },
      { clave: "entradas_periodo", etiqueta: "Entradas de inventario del periodo", formato: "n", destacado: true, sub: (i) => `${n0(i.salidas_periodo)} salidas · ${n0(i.empresas_sin_captura_7d)} empresas sin captura en 7 días`, liga: "/inventario/movimientos", semaforo: (_v, i) => semN(0)(i.empresas_sin_captura_7d ?? null) },
      { clave: "herramientas_asignadas", etiqueta: "Herramienta asignada", formato: "n", destacado: true, sub: (i) => `de ${n0(i.herramientas)} · ${n0(i.herramientas_vencidas)} con regreso vencido · ${n0(i.herramientas_extraviadas)} extraviadas`, liga: "/almacen/herramienta", semaforo: (_v, i) => semN(0)((i.herramientas_vencidas ?? 0) + (i.herramientas_extraviadas ?? 0)) },
    ],
    secciones: [
      { clave: "oc_por_empresa", titulo: "Compras por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "n", etiqueta: "Órdenes", formato: "n" }, { clave: "servicios", etiqueta: "De servicio", formato: "n" }, { clave: "monto", etiqueta: "Monto s/IVA", formato: "money" }], liga: "/ordenes?tipo=OC&backoffice=1", barras: { etiqueta: "empresa", valor: "monto" } },
      { clave: "top_proveedores", titulo: "Proveedores con más compra en el periodo", columnas: [{ clave: "proveedor", etiqueta: "Proveedor" }, { clave: "empresas", etiqueta: "Empresas" }, { clave: "n", etiqueta: "Órdenes", formato: "n" }, { clave: "monto", etiqueta: "Monto s/IVA", formato: "money" }], liga: "/compras/catalogo", barras: { etiqueta: "proveedor", valor: "monto" } },
      { clave: "inventario_por_empresa", titulo: "Inventario por empresa", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "productos", etiqueta: "Productos", formato: "n" }, { clave: "negativos", etiqueta: "Negativos", formato: "n" }, { clave: "valor", etiqueta: "Valor", formato: "money" }, { clave: "movimientos_periodo", etiqueta: "Mov. periodo", formato: "n" }, { clave: "ultima_captura", etiqueta: "Última captura", formato: "fecha" }], liga: "/inventario/resumen" },
      { clave: "herramienta_vencida", titulo: "Herramienta con regreso vencido", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "nombre", etiqueta: "Herramienta" }, { clave: "responsable", etiqueta: "Responsable" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "devolver_el", etiqueta: "Debía regresar", formato: "fecha" }, { clave: "dias", etiqueta: "Días", formato: "dias" }], liga: "/almacen/herramienta" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "existencias_negativas") > 0) a.push({ nivel: num(i, "existencias_negativas") > 10 ? "rojo" : "ambar", texto: `${n0(i.existencias_negativas)} existencias negativas: se registraron salidas sin su entrada.`, ruta: "/inventario/existencias" });
      if (num(i, "requisiciones_sin_resolver") > 0) a.push({ nivel: num(i, "requisiciones_sin_resolver") > 5 ? "rojo" : "ambar", texto: `${n0(i.requisiciones_sin_resolver)} requerimiento(s) esperando a compras.`, ruta: "/requisiciones?ver=sin_resolver" });
      if (num(i, "herramientas_vencidas") > 0) a.push({ nivel: "ambar", texto: `${n0(i.herramientas_vencidas)} herramienta(s) con fecha de regreso vencida.`, ruta: "/almacen/herramienta" });
      if (num(i, "herramientas_extraviadas") > 0) a.push({ nivel: "rojo", texto: `${n0(i.herramientas_extraviadas)} herramienta(s) extraviada(s).`, ruta: "/almacen/herramienta" });
      if (num(i, "empresas_sin_captura_7d") > 0) a.push({ nivel: "ambar", texto: `${n0(i.empresas_sin_captura_7d)} empresa(s) con inventario no registran movimientos desde hace una semana.`, ruta: "/inventario/resumen" });
      if (num(i, "oc_por_autorizar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.oc_por_autorizar)} orden(es) del periodo siguen sin autorizar.`, ruta: "/finanzas/por-autorizar" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Compras del periodo: ${n0(i.oc_periodo)} OC/OS por ${moneda(i.oc_periodo_monto)} s/IVA a ${n0(i.proveedores_periodo)} proveedores (${n0(i.oc_backoffice)} del backoffice, ${n0(i.oc_acumulado)} capturadas aquí).`,
        `Requerimientos: ${n0(i.requisiciones_periodo)} nuevos, ${n0(i.requisiciones_sin_resolver)} sin resolver, ${n0(i.requisiciones_en_camino)} en bodega o en camino a obra.`,
        `Inventario: ${n0(i.productos)} productos, valor ${moneda(i.valor_inventario)}, ${n0(i.existencias_negativas)} existencias negativas; ${n0(i.entradas_periodo)} entradas y ${n0(i.salidas_periodo)} salidas en el periodo.`,
        `Herramienta: ${n0(i.herramientas_asignadas)} de ${n0(i.herramientas)} asignadas; ${n0(i.herramientas_vencidas)} con regreso vencido, ${n0(i.herramientas_extraviadas)} extraviadas, ${n0(i.herramientas_reparacion)} en reparación.`,
      ];
    },
    porRevisar: [
      "Solo AEP y MCC tienen inventario capturado: definir qué empresas deben llevarlo.",
      "La herramienta todavía no se da de alta en el sistema: los ceros son reales.",
      "Si 'comprado' debe ser s/IVA (hoy) o c/IVA como lo ve el backoffice.",
      "Agregar el histórico de precios por proveedor (variación contra la compra anterior).",
    ],
  },
  mantenimiento: {
    clave: "mantenimiento",
    titulo: "Mantenimiento (BBVA)",
    cubre: "folios del control de BBVA (trámite administrativo y cobro) · gasto del equipo por cliente · mano de obra",
    ruta: "/mantenimiento/bbva",
    // El control de Christian marca todos los folios vivos como 'Terminado'
    // operativamente; lo que avanza es la etapa administrativa (preparar
    // fichero → esperar autorización → fichero realizado) y el cobro.
    indicadores: [
      { clave: "folios_abiertos", etiqueta: "Folios en trámite (sin fichero realizado)", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `de ${n0(i.folios_total)} · ${n0(i.esperando_autorizacion)} esperando autorización · ${n0(i.viejos_30)} con más de 30 días`, liga: "/mantenimiento/bbva", semaforo: (_v, i) => semN(10)(i.viejos_30 ?? null) },
      { clave: "recibidos_periodo", etiqueta: "Folios recibidos en el periodo", formato: "n", destacado: true, sub: (i) => `${n0(i.finalizados_periodo)} finalizados (aceptados por el cliente) en el periodo`, liga: "/mantenimiento/bbva" },
      { clave: "monto_a_cobrar", etiqueta: "Monto a cobrar (folios no cancelados)", formato: "money", destacado: true, masEsMejor: true, sub: (i) => `cobrado ${moneda(i.monto_cobrado)} · falta ${moneda(i.saldo_calculado)}`, liga: "/mantenimiento/bbva" },
      { clave: "sin_cobro_monto", etiqueta: "Folios con monto y sin ningún cobro", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.sin_cobro)} folios`, liga: "/mantenimiento/bbva", semaforo: (_v, i) => semN(20)(i.sin_cobro ?? null) },
      { clave: "finalizados_sin_pedido", etiqueta: "Folios sin pedido de BBVA", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.finalizados_sin_factura)} sin factura`, liga: "/mantenimiento/bbva", semaforo: semN(20) },
      { clave: "gasto_oc_periodo", etiqueta: "Gasto en OC/OS de BBVA (periodo, s/IVA)", formato: "money", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.oc_periodo)} órdenes`, liga: "/ordenes?tipo=OC&buscar=BBVA&backoffice=1" },
      { clave: "mano_obra_periodo", etiqueta: "Mano de obra del equipo (periodo)", formato: "money", destacado: true, sub: (i) => `${n0(i.personas_equipo)} personas`, liga: "/rh/mano-de-obra?buscar=BBVA" },
      { clave: "saldo_por_cobrar", etiqueta: "Saldo por cobrar según la columna del control", formato: "money", masEsMejor: false, sub: (i) => `calculado (a cobrar − cobrado): ${moneda(i.saldo_calculado)}`, liga: "/mantenimiento/bbva" },
      { clave: "cancelados", etiqueta: "Folios cancelados", formato: "n", masEsMejor: false, liga: "/mantenimiento/bbva" },
    ],
    secciones: [
      { clave: "por_etapa", titulo: "Folios por etapa administrativa", columnas: [{ clave: "etapa", etiqueta: "Etapa" }, { clave: "n", etiqueta: "Folios", formato: "n" }, { clave: "monto", etiqueta: "Monto a cobrar", formato: "money" }, { clave: "sin_cobro", etiqueta: "Sin cobro", formato: "n" }], liga: "/mantenimiento/bbva", barras: { etiqueta: "etapa", valor: "n" } },
      { clave: "por_supervisor", titulo: "Por supervisor", columnas: [{ clave: "supervisor", etiqueta: "Supervisor" }, { clave: "folios", etiqueta: "Folios", formato: "n" }, { clave: "abiertos", etiqueta: "En trámite", formato: "n" }, { clave: "finalizados_periodo", etiqueta: "Finalizados en el periodo", formato: "n" }, { clave: "monto", etiqueta: "Monto a cobrar", formato: "money" }, { clave: "sin_cobro", etiqueta: "Sin cobro", formato: "money" }], liga: "/mantenimiento/bbva", barras: { etiqueta: "supervisor", valor: "monto" } },
      { clave: "folios_sin_cobro", titulo: "Folios con monto y sin cobro (mayores)", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "sucursal", etiqueta: "Sucursal" }, { clave: "aceptacion", etiqueta: "Aceptado", formato: "fecha" }, { clave: "etapa", etiqueta: "Etapa" }, { clave: "pedido", etiqueta: "Pedido" }, { clave: "factura", etiqueta: "Factura" }, { clave: "monto", etiqueta: "Monto", formato: "money" }], liga: "/mantenimiento/bbva" },
      { clave: "gasto_por_cliente", titulo: "Gasto del equipo por cliente (OC/OS del periodo)", columnas: [{ clave: "cliente", etiqueta: "Cliente del gasto" }, { clave: "n", etiqueta: "Órdenes", formato: "n" }, { clave: "monto", etiqueta: "Monto s/IVA", formato: "money" }], liga: "/proyectos", nota: "El cliente se elige en cada orden desde el resumen de la obra o el avance financiero; lo sin cliente va a BBVA." },
      { clave: "folios_viejos", titulo: "Folios en trámite más antiguos", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "sucursal", etiqueta: "Sucursal" }, { clave: "recepcion", etiqueta: "Recibido", formato: "fecha" }, { clave: "dias", etiqueta: "Días", formato: "dias" }, { clave: "etapa", etiqueta: "Etapa" }, { clave: "supervisor", etiqueta: "Supervisor" }, { clave: "monto", etiqueta: "Monto", formato: "money" }], liga: "/mantenimiento/bbva" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "sin_cobro") > 0) a.push({ nivel: num(i, "sin_cobro") > 20 ? "rojo" : "ambar", texto: `${n0(i.sin_cobro)} folios con monto a cobrar (${moneda(i.sin_cobro_monto)}) no tienen ningún cobro registrado.`, ruta: "/mantenimiento/bbva" });
      if (num(i, "viejos_30") > 0) a.push({ nivel: num(i, "viejos_30") > 10 ? "rojo" : "ambar", texto: `${n0(i.viejos_30)} folios llevan más de 30 días sin fichero realizado.`, ruta: "/mantenimiento/bbva" });
      if (num(i, "esperando_autorizacion") > 0) a.push({ nivel: "ambar", texto: `${n0(i.esperando_autorizacion)} folios esperan autorización de BBVA.`, ruta: "/mantenimiento/bbva" });
      if (num(i, "finalizados_sin_pedido") > 0) a.push({ nivel: "ambar", texto: `${n0(i.finalizados_sin_pedido)} folios sin pedido de BBVA y ${n0(i.finalizados_sin_factura)} sin factura: no se pueden cobrar.`, ruta: "/mantenimiento/bbva" });
      if (Math.abs(num(i, "saldo_por_cobrar") - num(i, "saldo_calculado")) > 1000) a.push({ nivel: "ambar", texto: `La columna "saldo por cobrar" del control (${moneda(i.saldo_por_cobrar)}) no cuadra con a cobrar − cobrado (${moneda(i.saldo_calculado)}).`, ruta: "/mantenimiento/bbva" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `${n0(i.folios_total)} folios en el control de BBVA: ${n0(i.folios_abiertos)} en trámite administrativo (${n0(i.esperando_autorizacion)} esperando autorización, ${n0(i.viejos_30)} con más de 30 días), ${n0(i.cancelados)} cancelados; ${n0(i.recibidos_periodo)} recibidos y ${n0(i.finalizados_periodo)} aceptados por el cliente en el periodo.`,
        `Cobranza de folios: ${moneda(i.monto_a_cobrar)} a cobrar, ${moneda(i.monto_cobrado)} cobrado, faltan ${moneda(i.saldo_calculado)}; ${n0(i.sin_cobro)} folios (${moneda(i.sin_cobro_monto)}) sin ningún cobro, ${n0(i.finalizados_sin_pedido)} sin pedido y ${n0(i.finalizados_sin_factura)} sin factura.`,
        `Gasto del equipo en el periodo: ${moneda(i.gasto_oc_periodo)} en ${n0(i.oc_periodo)} OC/OS más ${moneda(i.mano_obra_periodo)} de mano de obra (${n0(i.personas_equipo)} personas).`,
      ];
    },
    porRevisar: [
      "Con Christian: la columna 'saldo por cobrar' del control no cuadra con a cobrar − cobrado (al 5-nov: $2,566 contra $416,377 de saldo en 63 folios sin cobro; en otros el cobro rebasa el monto); cuál es la buena.",
      "Confirmar que 'Fichero realizado' significa que el folio ya está cobrado o facturado; si no, qué etapa cierra el folio.",
      "Las fechas de finalización y de primera atención vienen vacías en el control: el reporte usa la aceptación del cliente como fecha de cierre.",
      "Si el gasto del equipo debe medirse contra lo cobrado a BBVA (margen por folio).",
      "Asignar 'cliente del gasto' a las OC que fueron para oficinas u obras privadas para que el reparto por cliente tenga datos.",
    ],
  },
  produccion: {
    clave: "produccion",
    titulo: "Producción (plantas)",
    cubre: "lotes de Clavicón y Balken · costo por pieza · remisiones y margen · existencias de materia prima y producto terminado",
    ruta: "/produccion",
    indicadores: [
      { clave: "lotes_terminados_periodo", etiqueta: "Lotes terminados en el periodo", formato: "n", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.piezas_periodo)} piezas · ${n0(i.lotes_en_proceso)} en proceso · ${n0(i.lotes_planeados)} planeados`, liga: "/produccion" },
      { clave: "costo_unitario_ultimo", etiqueta: "Costo por pieza del último lote", formato: "money", destacado: true, masEsMejor: false, liga: "/produccion" },
      { clave: "venta_periodo", etiqueta: "Venta de planta en el periodo (remisiones, s/IVA)", formato: "money", destacado: true, masEsMejor: true, sub: (i) => `${n0(i.remisiones_periodo)} remisiones · costo ${moneda(i.costo_periodo)}`, liga: "/produccion" },
      { clave: "margen_pct", etiqueta: "Margen de la planta", formato: "pct", destacado: true, masEsMejor: true, sub: (i) => `${moneda(i.margen_periodo)} · ${n0(i.remisiones_sin_precio)} remisiones sin precio`, liga: "/produccion", semaforo: (v) => (v == null ? "gris" : v >= 15 ? "verde" : v >= 0 ? "ambar" : "rojo") },
      { clave: "valor_materia_prima", etiqueta: "Materia prima en existencia (PEPS)", formato: "money", destacado: true, liga: "/produccion" },
      { clave: "valor_producto_terminado", etiqueta: "Producto terminado en existencia (PEPS)", formato: "money", destacado: true, sub: (i) => `${n0(i.piezas_terminadas_stock)} piezas`, liga: "/produccion", semaforo: (_v, i) => ((i.piezas_terminadas_stock ?? 0) < 0 ? "rojo" : "gris") },
      { clave: "por_facturar", etiqueta: "Remisiones de planta por facturar", formato: "n", masEsMejor: false, liga: "/contabilidad/remisiones", semaforo: semN(5) },
    ],
    secciones: [
      { clave: "lotes", titulo: "Lotes recientes", columnas: [{ clave: "folio", etiqueta: "Lote" }, { clave: "empresa", etiqueta: "Planta" }, { clave: "producto", etiqueta: "Producto" }, { clave: "estado", etiqueta: "Estado" }, { clave: "inicio", etiqueta: "Inicio", formato: "fecha" }, { clave: "fin", etiqueta: "Fin", formato: "fecha" }, { clave: "cantidad", etiqueta: "Piezas", formato: "n" }, { clave: "costo_unitario", etiqueta: "Costo/pieza", formato: "money" }], liga: "/produccion" },
      { clave: "remisiones", titulo: "Remisiones de planta del periodo", columnas: [{ clave: "fecha", etiqueta: "Fecha", formato: "fecha" }, { clave: "folio", etiqueta: "Folio" }, { clave: "empresa", etiqueta: "Planta" }, { clave: "cliente", etiqueta: "Cliente" }, { clave: "venta", etiqueta: "Venta", formato: "money" }, { clave: "costo", etiqueta: "Costo", formato: "money" }, { clave: "margen", etiqueta: "Margen", formato: "money" }], liga: "/produccion" },
      { clave: "stock_producto_terminado", titulo: "Producto terminado en existencia", columnas: [{ clave: "producto", etiqueta: "Producto" }, { clave: "empresa", etiqueta: "Planta" }, { clave: "stock", etiqueta: "Existencia", formato: "n" }, { clave: "unidad", etiqueta: "Unidad" }, { clave: "valor", etiqueta: "Valor PEPS", formato: "money" }], liga: "/produccion" },
      { clave: "stock_materia_prima", titulo: "Materia prima en existencia", columnas: [{ clave: "materia", etiqueta: "Materia prima" }, { clave: "empresa", etiqueta: "Planta" }, { clave: "stock", etiqueta: "Existencia", formato: "n" }, { clave: "unidad", etiqueta: "Unidad" }, { clave: "valor", etiqueta: "Valor PEPS", formato: "money" }], liga: "/produccion" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if ((i.margen_pct ?? 100) < 0) a.push({ nivel: "rojo", texto: `La planta vendió por debajo de su costo en el periodo (margen ${pct(i.margen_pct)}).`, ruta: "/produccion" });
      else if (i.margen_pct != null && i.margen_pct < 15) a.push({ nivel: "ambar", texto: `Margen de la planta de ${pct(i.margen_pct)} en el periodo.`, ruta: "/produccion" });
      if ((i.piezas_terminadas_stock ?? 0) < 0) a.push({ nivel: "rojo", texto: `Existencia negativa de producto terminado (${n0(i.piezas_terminadas_stock)} piezas): se remisionó más de lo que entró de los lotes.`, ruta: "/produccion" });
      if (num(i, "remisiones_sin_precio") > 0) a.push({ nivel: "ambar", texto: `${n0(i.remisiones_sin_precio)} remisiones del periodo tienen partidas sin precio: el margen sale incompleto.`, ruta: "/produccion" });
      if (num(i, "por_facturar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.por_facturar)} remisiones de planta por facturar.`, ruta: "/contabilidad/remisiones" });
      if (num(i, "lotes_terminados_periodo") === 0 && num(i, "lotes_en_proceso") === 0) a.push({ nivel: "ambar", texto: "La planta no cerró ni tiene lotes en proceso en el periodo.", ruta: "/produccion" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Lotes: ${n0(i.lotes_terminados_periodo)} terminados en el periodo (${n0(i.piezas_periodo)} piezas), ${n0(i.lotes_en_proceso)} en proceso, ${n0(i.lotes_planeados)} planeados; último costo por pieza ${moneda(i.costo_unitario_ultimo)}.`,
        `Venta de planta: ${n0(i.remisiones_periodo)} remisiones por ${moneda(i.venta_periodo)} s/IVA con costo ${moneda(i.costo_periodo)} y margen ${moneda(i.margen_periodo)} (${pct(i.margen_pct)}).`,
        `Existencias: materia prima ${moneda(i.valor_materia_prima)}, producto terminado ${moneda(i.valor_producto_terminado)} (${n0(i.piezas_terminadas_stock)} piezas); ${n0(i.por_facturar)} remisiones por facturar.`,
      ];
    },
    porRevisar: [
      "Balken (VBB) no tiene productos ni lotes en la base: su vigueta sigue en la calculadora hasta darla de alta como producto con receta.",
      "Meta de margen de la planta (hoy verde ≥ 15 %).",
      "Agregar la proyección anual y el punto de equilibrio por planta.",
      "Separar Clavicón y Balken en los indicadores cuando las dos produzcan.",
    ],
  },
  legal: {
    clave: "legal",
    titulo: "Legal y cumplimiento",
    cubre: "asuntos y juicios · documentos legales de las empresas · arrendamientos · crédito a clientes · controles de cumplimiento e incidencias",
    ruta: "/legal",
    indicadores: [
      { clave: "asuntos_abiertos", etiqueta: "Asuntos y juicios abiertos", formato: "n", destacado: true, sub: (i) => `${n0(i.asuntos_fecha_vencida)} con fecha vencida · ${n0(i.asuntos_proximos_30)} con fecha en 30 días · en riesgo ${moneda(i.monto_en_riesgo)}`, liga: "/legal", semaforo: (_v, i) => semN(0)(i.asuntos_fecha_vencida ?? null) },
      { clave: "documentos_vencidos", etiqueta: "Documentos legales vencidos", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.documentos_por_vencer_30)} vencen en 30 días`, liga: "/legal?tab=empresa", semaforo: semN(0) },
      { clave: "arrendamientos_vigentes", etiqueta: "Arrendamientos vigentes", formato: "n", destacado: true, sub: (i) => `${n0(i.arrendamientos_por_vencer_60)} vencen en 60 días · ${n0(i.arrendamientos_vencidos)} vencidos`, liga: "/legal?tab=arrendamientos", semaforo: (_v, i) => semN(0)(i.arrendamientos_vencidos ?? null) },
      { clave: "creditos_por_autorizar", etiqueta: "Créditos a clientes por autorizar", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.creditos_autorizados)} autorizados por ${moneda(i.lineas_autorizadas)}`, liga: "/legal?tab=credito", semaforo: semN(0) },
      { clave: "controles_cumplen", etiqueta: "Controles de cumplimiento que cumplen", formato: "n", destacado: true, masEsMejor: true, sub: (i) => `de ${n0(i.controles_probados)} probados · ${n0(i.controles_no_cumplen)} no cumplen`, liga: "/cumplimiento", semaforo: (v, i) => (v == null || num(i, "controles_probados") === 0 ? "gris" : v === num(i, "controles_probados") ? "verde" : v >= num(i, "controles_probados") * 0.7 ? "ambar" : "rojo") },
      { clave: "incidencias_abiertas", etiqueta: "Incidencias abiertas", formato: "n", destacado: true, masEsMejor: false, sub: (i) => `${n0(i.incidencias_periodo)} registradas en el periodo`, liga: "/cumplimiento", semaforo: semN(2) },
    ],
    secciones: [
      { clave: "asuntos", titulo: "Asuntos y juicios abiertos", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "titulo", etiqueta: "Asunto" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "tipo", etiqueta: "Tipo" }, { clave: "proxima_fecha", etiqueta: "Próxima fecha", formato: "fecha" }, { clave: "actuacion", etiqueta: "Actuación" }, { clave: "riesgo", etiqueta: "En riesgo", formato: "money" }], liga: "/legal" },
      { clave: "documentos_por_vencer", titulo: "Documentos legales vencidos o por vencer (60 días)", columnas: [{ clave: "empresa", etiqueta: "Empresa" }, { clave: "tipo", etiqueta: "Tipo" }, { clave: "nombre", etiqueta: "Documento" }, { clave: "vence", etiqueta: "Vence", formato: "fecha" }, { clave: "dias", etiqueta: "Días", formato: "dias" }], liga: "/legal?tab=empresa" },
      { clave: "arrendamientos", titulo: "Arrendamientos", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "papel", etiqueta: "Papel" }, { clave: "contraparte", etiqueta: "Contraparte" }, { clave: "inmueble", etiqueta: "Inmueble" }, { clave: "renta", etiqueta: "Renta", formato: "money" }, { clave: "fin", etiqueta: "Termina", formato: "fecha" }], liga: "/legal?tab=arrendamientos" },
      { clave: "controles_no_cumplen", titulo: "Controles de cumplimiento que no cumplen (último periodo)", columnas: [{ clave: "clave", etiqueta: "Control" }, { clave: "nombre", etiqueta: "Qué revisa" }, { clave: "resultado", etiqueta: "Resultado" }, { clave: "excepciones", etiqueta: "Excepciones", formato: "n" }, { clave: "poblacion", etiqueta: "De", formato: "n" }], liga: "/cumplimiento", barras: { etiqueta: "clave", valor: "excepciones" } },
      { clave: "incidencias", titulo: "Incidencias abiertas", columnas: [{ clave: "folio", etiqueta: "Folio" }, { clave: "titulo", etiqueta: "Incidencia" }, { clave: "empresa", etiqueta: "Empresa" }, { clave: "severidad", etiqueta: "Severidad" }, { clave: "detectada", etiqueta: "Detectada", formato: "fecha" }, { clave: "estatus", etiqueta: "Estatus" }], liga: "/cumplimiento" },
    ],
    alertas: (d) => {
      const i = d.indicadores, a: AlertaArea[] = [];
      if (num(i, "asuntos_fecha_vencida") > 0) a.push({ nivel: "rojo", texto: `${n0(i.asuntos_fecha_vencida)} asunto(s) legal(es) con la próxima fecha ya vencida.`, ruta: "/legal" });
      if (num(i, "documentos_vencidos") > 0) a.push({ nivel: "rojo", texto: `${n0(i.documentos_vencidos)} documento(s) legal(es) de empresa vencidos.`, ruta: "/legal?tab=empresa" });
      if (num(i, "arrendamientos_vencidos") > 0) a.push({ nivel: "rojo", texto: `${n0(i.arrendamientos_vencidos)} contrato(s) de arrendamiento vencidos sin renovar.`, ruta: "/legal?tab=arrendamientos" });
      if (num(i, "creditos_por_autorizar") > 0) a.push({ nivel: "ambar", texto: `${n0(i.creditos_por_autorizar)} solicitud(es) de crédito a clientes esperando autorización de dirección.`, ruta: "/legal?tab=credito" });
      if (num(i, "controles_no_cumplen") > 0) a.push({ nivel: num(i, "controles_no_cumplen") > 3 ? "rojo" : "ambar", texto: `${n0(i.controles_no_cumplen)} de ${n0(i.controles_probados)} controles de cumplimiento no cumplen en el último periodo probado.`, ruta: "/cumplimiento" });
      if (num(i, "incidencias_abiertas") > 0) a.push({ nivel: "ambar", texto: `${n0(i.incidencias_abiertas)} incidencia(s) de cumplimiento sin cerrar.`, ruta: "/cumplimiento" });
      if (num(i, "documentos_por_vencer_30") > 0) a.push({ nivel: "ambar", texto: `${n0(i.documentos_por_vencer_30)} documento(s) legal(es) vencen en los próximos 30 días.`, ruta: "/legal?tab=empresa" });
      if (num(i, "arrendamientos_por_vencer_60") > 0) a.push({ nivel: "ambar", texto: `${n0(i.arrendamientos_por_vencer_60)} arrendamiento(s) vencen en 60 días.`, ruta: "/legal?tab=arrendamientos" });
      return ordenar(a);
    },
    resumen: (d) => {
      const i = d.indicadores;
      return [
        `Asuntos y juicios: ${n0(i.asuntos_abiertos)} abiertos, ${n0(i.asuntos_fecha_vencida)} con fecha vencida, ${n0(i.asuntos_proximos_30)} con fecha en 30 días; monto en riesgo ${moneda(i.monto_en_riesgo)}.`,
        `Documentos legales: ${n0(i.documentos_vencidos)} vencidos y ${n0(i.documentos_por_vencer_30)} por vencer; arrendamientos ${n0(i.arrendamientos_vigentes)} vigentes (${n0(i.arrendamientos_por_vencer_60)} vencen en 60 días).`,
        `Crédito a clientes: ${n0(i.creditos_autorizados)} autorizados por ${moneda(i.lineas_autorizadas)}, ${n0(i.creditos_por_autorizar)} por autorizar.`,
        `Cumplimiento: ${n0(i.controles_cumplen)} de ${n0(i.controles_probados)} controles cumplen en el último periodo; ${n0(i.incidencias_abiertas)} incidencias abiertas.`,
      ];
    },
    porRevisar: [
      "Asuntos, documentos legales y arrendamientos todavía no se capturan: los ceros son reales (Belén y Eréndira).",
      "Qué controles de cumplimiento son de dirección y cuáles de cada área, para repartirlos en los demás reportes.",
      "Si los créditos a clientes deben verse aquí o en Comercial.",
    ],
  },
};

function ordenar(a: AlertaArea[]): AlertaArea[] {
  return [...a].sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === "rojo" ? -1 : 1));
}

/** Alertas de un reporte (rojas primero). */
export function alertasArea(d: ReporteArea): AlertaArea[] {
  return AREAS_REPORTE[d.area].alertas(d);
}

/** Resumen ejecutivo en frases. */
export function resumenArea(d: ReporteArea): string[] {
  return AREAS_REPORTE[d.area].resumen(d);
}

/** Las definiciones de evolución de un área: sus indicadores numéricos con el formato de la lámina. */
export function renglonesEvolucionArea(area: AreaReporte): DefinicionRenglon[] {
  return AREAS_REPORTE[area].indicadores.map((i) => ({ clave: i.clave, etiqueta: i.etiqueta, formato: i.formato, masEsMejor: i.masEsMejor ?? true }));
}

/** Semáforo global del área: rojo si hay alertas rojas, ámbar si hay ámbar, verde si no hay nada. */
export function semaforoArea(d: ReporteArea): Semaforo {
  const a = alertasArea(d);
  return a.some((x) => x.nivel === "rojo") ? "rojo" : a.length ? "ambar" : "verde";
}
