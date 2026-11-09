// Cuenta de cargo de cada pago programado (9-nov-2026, Mario: "en
// programación de pagos necesito un apartado visible para tesorería (Delia)
// para ver a qué cuenta se va a pagar de manera específica"). Al 9-nov solo
// 1 de 11 transferencias pendientes traía cuenta: "Programar a pago N" y
// "Autorizar" la mandaban vacía y el formulario por OC la dejaba opcional.
// Reglas puras, sin DOM ni Supabase, para probarlas en node.

export interface CuentaCargo {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
}

export interface PagoConCuenta {
  id: string;
  empresa_id: string;
  cuenta_id: string | null;
  monto: number;
  metodo: "transferencia" | "efectivo" | "cheque";
  estatus: "pendiente" | "pagado" | "cancelado";
  fecha_programada: string;
}

export interface GrupoCuenta<P extends PagoConCuenta = PagoConCuenta> {
  /** null = pagos sin cuenta definida. */
  cuenta: CuentaCargo | null;
  empresa_id: string;
  pagos: P[];
  n: number;
  total: number;
}

/** "BBVA 5859 · alias". */
export function textoCuenta(c: Pick<CuentaCargo, "banco" | "ultimos_4" | "alias"> | null | undefined): string {
  if (!c) return "";
  return `${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}`;
}

/** El efectivo no sale de una cuenta; transferencia y cheque sí. */
export function necesitaCuenta(metodo: string | null | undefined): boolean {
  return metodo !== "efectivo";
}

/** Mensaje de error si falta la cuenta de cargo al programar un pago que no
 * es en efectivo; null si está bien. */
export function revisarCuentaCargo(metodoOCondicion: string | null | undefined, cuentaId: string | null | undefined): string | null {
  if (!necesitaCuenta(metodoOCondicion)) return null;
  if (!cuentaId) return "Elige la cuenta de la que sale el pago: tesorería necesita saber desde qué banco pagar.";
  return null;
}

/** Cuenta que se propone al programar: la única de la empresa, o la última
 * que se usó para esa empresa si sigue activa; si no, ninguna. */
export function cuentaSugerida(cuentasEmpresa: CuentaCargo[], ultimaUsada: string | null | undefined): string {
  if (cuentasEmpresa.length === 1) return cuentasEmpresa[0].id;
  if (ultimaUsada && cuentasEmpresa.some((c) => c.id === ultimaUsada)) return ultimaUsada;
  return "";
}

/** Agrupa los pagos pendientes que salen de un banco (sin efectivo) por
 * cuenta de cargo; al final los que no tienen cuenta. Orden: por empresa de
 * la cuenta, banco y últimos 4. */
export function agruparPorCuenta<P extends PagoConCuenta>(pagos: P[], cuentas: CuentaCargo[]): { grupos: GrupoCuenta<P>[]; sinCuenta: GrupoCuenta<P>[]; total: number } {
  const porId = new Map(cuentas.map((c) => [c.id, c]));
  const mapa = new Map<string, GrupoCuenta<P>>();
  const sin = new Map<string, GrupoCuenta<P>>();
  let total = 0;
  for (const p of pagos) {
    if (p.estatus !== "pendiente" || !necesitaCuenta(p.metodo)) continue;
    const monto = Number(p.monto) || 0;
    total += monto;
    const cuenta = p.cuenta_id ? porId.get(p.cuenta_id) ?? null : null;
    const destino = cuenta ? mapa : sin;
    const clave = cuenta ? cuenta.id : p.empresa_id;
    const g = destino.get(clave) ?? { cuenta, empresa_id: cuenta?.empresa_id ?? p.empresa_id, pagos: [], n: 0, total: 0 };
    g.pagos.push(p);
    g.n += 1;
    g.total = redondear(g.total + monto);
    destino.set(clave, g);
  }
  const orden = (a: GrupoCuenta<P>, b: GrupoCuenta<P>) => (a.empresa_id === b.empresa_id ? textoCuenta(a.cuenta).localeCompare(textoCuenta(b.cuenta)) : a.empresa_id.localeCompare(b.empresa_id));
  return { grupos: [...mapa.values()].sort(orden), sinCuenta: [...sin.values()].sort(orden), total: redondear(total) };
}

/** Saldo del banco de esa cuenta menos lo que hay programado contra ella:
 * negativo = no alcanza. null si no hay estado de cuenta. */
export function quedaEnCuenta(saldoBanco: number | null | undefined, programado: number): number | null {
  if (saldoBanco == null) return null;
  return redondear(saldoBanco - programado);
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
