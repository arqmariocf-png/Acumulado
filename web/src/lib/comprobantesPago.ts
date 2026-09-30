// Avance de comprobantes de pago (Mario, 30-sep-2026: "avísale a Delia en el
// Dashboard cuántos en porcentaje de los pagos les falta el comprobante para
// que se haga el acumulado en automático"). Se cuenta sobre los pagos ya
// marcados como pagados; en efectivo también llevan comprobante.

export interface AvanceComprobantes {
  pagados: number;
  sinComprobante: number;
  porcentajeSin: number;
  color: "verde" | "ambar" | "rojo" | "gris";
}

export function avanceComprobantes(pagados: number, sinComprobante: number): AvanceComprobantes {
  const sin = Math.max(0, Math.min(sinComprobante, pagados));
  if (pagados <= 0) return { pagados: 0, sinComprobante: 0, porcentajeSin: 0, color: "gris" };
  const porcentajeSin = Math.round((sin / pagados) * 100);
  const color = sin === 0 ? "verde" : porcentajeSin >= 20 ? "rojo" : "ambar";
  return { pagados, sinComprobante: sin, porcentajeSin, color };
}

export function textoComprobantes(a: AvanceComprobantes): string {
  if (a.pagados === 0) return "Todavía no hay pagos marcados como pagados.";
  if (a.sinComprobante === 0) return `Los ${a.pagados} pagos tienen comprobante.`;
  return `Al ${a.porcentajeSin} % de los pagos les falta el comprobante (${a.sinComprobante} de ${a.pagados}).`;
}
