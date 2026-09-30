// Hoja de pagos del día por empresa, con la lógica de saldo que usa Laura
// en su Excel "PAGOS 30.09.26" (30-sep-2026): por empresa, primero el saldo
// inicial de cada cuenta como abono, luego los pagos del día como cargo, y
// un saldo corrido renglón por renglón; al final abonos, cargos y saldo.
// Sin DOM: se prueba en node y arma también el HTML imprimible y el CSV.

export interface CuentaHoja {
  empresa_id: string;
  empresa_nombre: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
  saldo_inicial: number;
}

export interface PagoHoja {
  empresa_id: string;
  empresa_nombre: string;
  id_orden: string | null;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  estatus: "pendiente" | "pagado" | "cancelado";
  metodo: "transferencia" | "efectivo" | "cheque";
  tipo_pago_backoffice: string | null;
  oc_proyecto: string | null;
  notas: string | null;
  referencia?: string | null;
}

export interface RenglonHoja {
  tipo: "saldo" | "pago";
  oc: string | null;
  proveedor: string;
  abono: number | null;
  cargo: number | null;
  saldo: number;
  forma_pago: string | null;
  proyecto: string | null;
  comentarios: string | null;
}

export interface HojaEmpresa {
  empresa_id: string;
  empresa_nombre: string;
  renglones: RenglonHoja[];
  abonos: number;
  cargos: number;
  saldo: number;
  /** Pagos en efectivo del día: no salen del banco, van aparte. */
  efectivo: number;
  n_efectivo: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const METODO: Record<PagoHoja["metodo"], string> = { transferencia: "Transferencia", efectivo: "Efectivo", cheque: "Cheque" };

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Pagos de la fecha (no cancelados) y los pendientes vencidos de días
 * anteriores, que siguen por pagar. El efectivo no toca el saldo. */
export function armarHojaPagos(cuentas: CuentaHoja[], pagos: PagoHoja[], fecha: string): HojaEmpresa[] {
  const mapa = new Map<string, HojaEmpresa>();
  const hoja = (id: string, nombre: string) => {
    let h = mapa.get(id);
    if (!h) {
      h = { empresa_id: id, empresa_nombre: nombre, renglones: [], abonos: 0, cargos: 0, saldo: 0, efectivo: 0, n_efectivo: 0 };
      mapa.set(id, h);
    }
    return h;
  };
  for (const c of cuentas) {
    const h = hoja(c.empresa_id, c.empresa_nombre);
    const monto = r2(Number(c.saldo_inicial) || 0);
    h.abonos = r2(h.abonos + monto);
    h.saldo = r2(h.saldo + monto);
    h.renglones.push({ tipo: "saldo", oc: null, proveedor: `SALDO INICIAL ${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}`.toUpperCase(), abono: monto, cargo: null, saldo: h.saldo, forma_pago: null, proyecto: null, comentarios: null });
  }
  const delDia = pagos.filter((p) => p.estatus !== "cancelado" && (p.fecha_programada === fecha || (p.estatus === "pendiente" && p.fecha_programada < fecha)));
  // OC por folio (como número), luego los pagos sin OC (nómina, préstamos…).
  delDia.sort((a, b) => {
    if (!!a.id_orden !== !!b.id_orden) return a.id_orden ? -1 : 1;
    return (a.id_orden ?? "").localeCompare(b.id_orden ?? "", "es", { numeric: true }) || a.beneficiario.localeCompare(b.beneficiario, "es");
  });
  for (const p of delDia) {
    const h = hoja(p.empresa_id, p.empresa_nombre);
    const monto = r2(Number(p.monto) || 0);
    if (p.metodo === "efectivo") {
      h.efectivo = r2(h.efectivo + monto);
      h.n_efectivo += 1;
      continue;
    }
    h.cargos = r2(h.cargos + monto);
    h.saldo = r2(h.saldo - monto);
    const comentarios = [
      p.fecha_programada < fecha ? `vencido del ${ddmm(p.fecha_programada)}` : null,
      p.estatus === "pagado" ? `pagado${p.referencia ? ` · ref ${p.referencia}` : ""}` : null,
      p.notas,
    ].filter(Boolean);
    h.renglones.push({
      tipo: "pago",
      oc: p.id_orden,
      proveedor: p.id_orden ? p.beneficiario : p.concepto && p.concepto !== p.beneficiario ? `${p.beneficiario} · ${p.concepto}` : p.beneficiario,
      abono: null,
      cargo: monto,
      saldo: h.saldo,
      forma_pago: p.tipo_pago_backoffice ?? METODO[p.metodo],
      proyecto: p.oc_proyecto,
      comentarios: comentarios.length ? comentarios.join(" · ") : null,
    });
  }
  return [...mapa.values()].filter((h) => h.renglones.some((r) => r.tipo === "pago") || h.abonos !== 0 || h.n_efectivo > 0).sort((a, b) => a.empresa_nombre.localeCompare(b.empresa_nombre, "es"));
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function moneda(n: number | null): string {
  if (n == null) return "";
  return `$ ${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Hoja imprimible con el mismo formato del Excel de Laura. */
export function htmlHojaPagos(fechaTexto: string, hojas: HojaEmpresa[]): string {
  const bloques = hojas
    .map(
      (h) => `
  <table>
    <thead>
      <tr class="emp"><th colspan="8">${esc(h.empresa_nombre)}</th></tr>
      <tr><th>OC</th><th>Proveedor</th><th class="r">Abono</th><th class="r">Cargo</th><th class="r">Saldo</th><th>Forma de pago</th><th>Proyecto</th><th>Comentarios</th></tr>
    </thead>
    <tbody>
      ${h.renglones
        .map(
          (r) =>
            `<tr${r.saldo < 0 ? ' class="neg"' : ""}><td>${esc(r.oc)}</td><td class="c">${esc(r.proveedor)}</td><td class="r">${moneda(r.abono)}</td><td class="r">${moneda(r.cargo)}</td><td class="r">${moneda(r.saldo)}</td><td>${esc(r.forma_pago)}</td><td>${esc(r.proyecto)}</td><td>${esc(r.comentarios)}</td></tr>`,
        )
        .join("")}
      <tr class="tot"><td></td><td></td><td class="r">${moneda(h.abonos)}</td><td class="r">${moneda(h.cargos)}</td><td class="r">${moneda(h.saldo)}</td><td colspan="3">${h.n_efectivo ? `Efectivo aparte (no sale del banco): ${h.n_efectivo} · ${moneda(h.efectivo)}` : ""}</td></tr>
    </tbody>
  </table>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pagos ${esc(fechaTexto)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 13px; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { border: 1px solid #d4d4d8; padding: 3px 5px; }
  thead th { background: #0f2340; color: #fff; font-size: 10px; text-transform: uppercase; }
  tr.emp th { text-align: left; font-size: 12px; text-transform: none; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  tr.tot td { background: #dbeafe; font-weight: bold; }
  tr.neg td { color: #b91c1c; }
  .btn { position: fixed; top: 8px; right: 8px; padding: 6px 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
  @media print { .btn { display: none; } body { margin: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<h1>PAGOS ${esc(fechaTexto)}</h1>
${bloques || "<p>Sin pagos ni saldos para esta fecha.</p>"}
</body></html>`;
}

function celda(v: string | number | null): string {
  if (v == null) return "";
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV para abrir en Excel (con BOM para acentos). */
export function csvHojaPagos(hojas: HojaEmpresa[]): string {
  const filas: string[] = [];
  for (const h of hojas) {
    filas.push(celda(h.empresa_nombre));
    filas.push("OC,PROVEEDOR,ABONO,CARGO,SALDO,FORMA DE PAGO,PROYECTO,COMENTARIOS");
    for (const r of h.renglones) filas.push([r.oc, r.proveedor, r.abono?.toFixed(2) ?? null, r.cargo?.toFixed(2) ?? null, r.saldo.toFixed(2), r.forma_pago, r.proyecto, r.comentarios].map(celda).join(","));
    filas.push(["", "TOTAL", h.abonos.toFixed(2), h.cargos.toFixed(2), h.saldo.toFixed(2), "", "", h.n_efectivo ? `Efectivo aparte: ${h.efectivo.toFixed(2)}` : ""].map(celda).join(","));
    filas.push("");
  }
  return "﻿" + filas.join("\n");
}
