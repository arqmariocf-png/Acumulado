// Comedor (30-sep-2026): el trabajador pide desde su app y se le descuenta
// por nómina. Reglas puras para la pantalla; la base las vuelve a aplicar
// (fn_comedor_pedir, fn_comedor_entregar, fn_comedor_aplicar_descuento).

export interface PlatilloMenu {
  platillo_id: string;
  nombre: string;
  precio: number;
}

export interface PedidoComedor {
  id: string;
  fecha: string;
  profile_id: string;
  trabajador_nombre: string | null;
  empresa_trabajador_id: string | null;
  empresa_trabajador: string | null;
  estado: "pedido" | "entregado" | "cancelado";
  total: number;
  piezas: number;
  detalle: string;
  descuento_aplicado_en: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hora límite en México (UTC−6, sin horario de verano desde 2022). */
export function cierrePedido(fecha: string, horaLimite: string): Date {
  const [h, m] = horaLimite.split(":").map(Number);
  const [a, mes, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, mes - 1, d, h + 6, m ?? 0));
}

export function puedePedir(fecha: string, horaLimite: string, ahora: Date = new Date()): boolean {
  return ahora.getTime() <= cierrePedido(fecha, horaLimite).getTime();
}

export function totalSeleccion(menu: PlatilloMenu[], cantidades: Record<string, number>): number {
  return r2(menu.reduce((s, p) => s + p.precio * Math.max(0, cantidades[p.platillo_id] ?? 0), 0));
}

export interface RenglonNomina {
  profile_id: string;
  trabajador: string;
  empresa_trabajador_id: string | null;
  empresa: string;
  comidas: number;
  total: number;
  pendiente: number;
  aplicado: number;
}

/** Descuento por trabajador: solo lo ENTREGADO; separa lo ya aplicado. */
export function resumenNomina(pedidos: PedidoComedor[]): RenglonNomina[] {
  const m = new Map<string, RenglonNomina>();
  for (const p of pedidos) {
    if (p.estado !== "entregado") continue;
    const k = p.profile_id;
    const r = m.get(k) ?? {
      profile_id: k,
      trabajador: p.trabajador_nombre ?? "—",
      empresa_trabajador_id: p.empresa_trabajador_id,
      empresa: p.empresa_trabajador ?? "—",
      comidas: 0,
      total: 0,
      pendiente: 0,
      aplicado: 0,
    };
    r.comidas += 1;
    r.total = r2(r.total + Number(p.total));
    if (p.descuento_aplicado_en) r.aplicado = r2(r.aplicado + Number(p.total));
    else r.pendiente = r2(r.pendiente + Number(p.total));
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.empresa.localeCompare(b.empresa) || a.trabajador.localeCompare(b.trabajador));
}

/** CSV para nómina (UTF-8 con BOM para que Excel respete los acentos). */
export function csvNomina(renglones: RenglonNomina[], desde: string, hasta: string): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const filas = [
    ["Empresa", "Trabajador", "Comidas", "Descuento pendiente", "Ya aplicado", `Periodo ${desde} a ${hasta}`],
    ...renglones.map((r) => [r.empresa, r.trabajador, r.comidas, r.pendiente.toFixed(2), r.aplicado.toFixed(2), ""]),
  ];
  return "﻿" + filas.map((f) => f.map(esc).join(",")).join("\n");
}

/** Cuántas piezas de cada platillo hay que preparar (pedidos no cancelados). */
export function porPreparar(pedidos: PedidoComedor[]): { platillo: string; piezas: number }[] {
  const m = new Map<string, number>();
  for (const p of pedidos) {
    if (p.estado === "cancelado" || !p.detalle) continue;
    for (const parte of p.detalle.split(", ")) {
      const i = parte.indexOf(" ");
      const n = Number(parte.slice(0, i));
      const nombre = parte.slice(i + 1);
      if (!Number.isFinite(n) || !nombre) continue;
      m.set(nombre, (m.get(nombre) ?? 0) + n);
    }
  }
  return [...m.entries()].map(([platillo, piezas]) => ({ platillo, piezas })).sort((a, b) => b.piezas - a.piezas);
}
