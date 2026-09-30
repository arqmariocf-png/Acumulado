// Desglose de IVA de un pago ligado a una OC (Mario, 30-sep-2026: "abajo del
// monto a pagar desglosa el IVA de ese pago"). El total de la OC ya incluye
// IVA (igual que en el backoffice); v_oc_importes trae subtotal e iva de la
// OC. Un pago parcial lleva el IVA en la misma proporción que la OC.

export interface DesgloseIva {
  subtotal: number;
  iva: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function desgloseIvaPago(monto: number, ocTotal: number | null | undefined, ocIva: number | null | undefined): DesgloseIva | null {
  const total = Number(ocTotal ?? 0);
  const ivaOc = Number(ocIva ?? 0);
  if (!(total > 0) || !(monto > 0)) return null;
  const iva = r2((monto * ivaOc) / total);
  return { subtotal: r2(monto - iva), iva };
}
