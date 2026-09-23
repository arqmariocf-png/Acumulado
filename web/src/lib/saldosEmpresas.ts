// Reporte simple de saldos por empresa (para Finanzas): agrupa las filas de
// fn_saldos_diario_cuenta por empresa y arma el HTML imprimible. Sin DOM.

export interface FilaSaldoCuenta {
  cuenta_id: string;
  empresa_id: string;
  empresa_nombre: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
  saldo_inicial: number;
  entradas: number;
  salidas: number;
  saldo_final: number;
  ajuste_saldo: number;
  tiene_movimientos: boolean;
}

export interface GrupoEmpresa {
  empresa_id: string;
  empresa_nombre: string;
  cuentas: FilaSaldoCuenta[];
  saldo_inicial: number;
  entradas: number;
  salidas: number;
  saldo_final: number;
}

export function agruparPorEmpresa(filas: FilaSaldoCuenta[]): { grupos: GrupoEmpresa[]; total: Omit<GrupoEmpresa, "empresa_id" | "empresa_nombre" | "cuentas"> } {
  const mapa = new Map<string, GrupoEmpresa>();
  for (const f of filas) {
    const g = mapa.get(f.empresa_id) ?? { empresa_id: f.empresa_id, empresa_nombre: f.empresa_nombre, cuentas: [], saldo_inicial: 0, entradas: 0, salidas: 0, saldo_final: 0 };
    g.cuentas.push(f);
    g.saldo_inicial += Number(f.saldo_inicial);
    g.entradas += Number(f.entradas);
    g.salidas += Number(f.salidas);
    g.saldo_final += Number(f.saldo_final);
    mapa.set(f.empresa_id, g);
  }
  const grupos = [...mapa.values()].sort((a, b) => a.empresa_nombre.localeCompare(b.empresa_nombre));
  const total = grupos.reduce(
    (t, g) => ({ saldo_inicial: t.saldo_inicial + g.saldo_inicial, entradas: t.entradas + g.entradas, salidas: t.salidas + g.salidas, saldo_final: t.saldo_final + g.saldo_final }),
    { saldo_inicial: 0, entradas: 0, salidas: 0, saldo_final: 0 },
  );
  return { grupos, total };
}

function esc(t: string | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function moneda(n: number): string {
  return Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

export function htmlSaldosEmpresas(fechaTexto: string, grupos: GrupoEmpresa[], total: { saldo_inicial: number; entradas: number; salidas: number; saldo_final: number }, elaboro: string | null): string {
  const cuerpo = grupos
    .map(
      (g) => `<tr class="emp"><td colspan="5">${esc(g.empresa_nombre)}</td></tr>` +
        g.cuentas
          .map((c) => `<tr><td class="cta">${esc(c.banco)} ${esc(c.ultimos_4)}${c.alias ? ` · ${esc(c.alias)}` : ""}</td><td class="r">${moneda(c.saldo_inicial)}</td><td class="r">${moneda(c.entradas)}</td><td class="r">${moneda(c.salidas)}</td><td class="r b">${moneda(c.saldo_final)}</td></tr>`)
          .join("") +
        `<tr class="sub"><td>Total ${esc(g.empresa_nombre)}</td><td class="r">${moneda(g.saldo_inicial)}</td><td class="r">${moneda(g.entradas)}</td><td class="r">${moneda(g.salidas)}</td><td class="r b">${moneda(g.saldo_final)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Saldos por empresa ${esc(fechaTexto)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  h1 { font-size: 16px; margin: 0; } .sub-t { color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; text-align: left; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  td.b { font-weight: bold; }
  tr.emp td { background: #f3f4f6; font-weight: bold; padding-top: 8px; }
  tr.sub td { font-weight: bold; border-bottom: 2px solid #999; }
  tr.tot td { font-weight: bold; font-size: 12px; background: #e5e7eb; }
  td.cta { padding-left: 14px; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  .pie { margin-top: 10px; font-size: 10px; color: #666; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <h1>Saldos por empresa · Grupo Loma</h1>
  <div class="sub-t">Al ${esc(fechaTexto)}${elaboro ? ` · elaboró ${esc(elaboro)}` : ""}</div>
  <table>
    <thead><tr><th>Empresa / cuenta</th><th class="r">Saldo inicial</th><th class="r">Entradas</th><th class="r">Salidas</th><th class="r">Saldo de cierre</th></tr></thead>
    <tbody>${cuerpo}
      <tr class="tot"><td>Total grupo</td><td class="r">${moneda(total.saldo_inicial)}</td><td class="r">${moneda(total.entradas)}</td><td class="r">${moneda(total.salidas)}</td><td class="r">${moneda(total.saldo_final)}</td></tr>
    </tbody>
  </table>
  <p class="pie">Saldo inicial = cierre del día anterior con movimientos cargados. Los saldos salen de los estados de cuenta cargados en la app; una cuenta sin carga reciente muestra su último cierre conocido.</p>
</div></body></html>`;
}
