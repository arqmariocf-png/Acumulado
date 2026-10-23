// Cuentas por cobrar (23-oct-2026): cálculo puro sobre lo que devuelve
// fn_cxc_cartera() (facturas PPD del SAT y estimaciones capturadas, cada una
// con total, cobrado y retenido). Saldo exigible = total − cobrado − retenido;
// vencido = saldo cuya fecha de vencimiento ya pasó; antigüedad en 5 rangos
// contados desde el vencimiento; cobranza esperada por semana, con las
// promesas de pago moviendo lo vencido a la semana prometida.

export interface DocumentoCxc {
  origen: "cfdi" | "manual";
  id: string;
  empresa_id: string;
  empresa: string;
  cliente_clave: string;
  cliente: string;
  rfc: string | null;
  /** Si el cliente es otra empresa del grupo. */
  cliente_empresa_id: string | null;
  cliente_empresa: string | null;
  tipo: string;
  folio: string;
  uuid: string | null;
  fecha: string;
  vence: string;
  total: number;
  retenido: number;
  cobrado: number;
  cobrado_sat?: number;
  cobrado_banco?: number;
  cobrado_aqui?: number;
  saldo: number;
  metodo_pago: string | null;
  proyecto_id: string | null;
  obra: string | null;
  cfdi_id: string | null;
}

export interface ClienteCxc {
  id?: string;
  clave: string;
  nombre: string;
  rfc: string | null;
  dias_credito: number;
  linea_credito: number | null;
  pue_a_credito: boolean;
  area: string | null;
  responsable: string | null;
  notas: string | null;
}

export interface GestionCxc {
  id?: string;
  cliente_clave: string;
  cliente_nombre?: string;
  tipo: string;
  fecha: string;
  nota: string | null;
  promesa_fecha: string | null;
  promesa_monto: number | null;
  created_by_nombre?: string | null;
}

export type FiltroClientes = "externos" | "grupo" | "todos";
export type RangoAntiguedad = "corriente" | "d1_30" | "d31_60" | "d61_90" | "mas_90";

export const RANGOS: { clave: RangoAntiguedad; etiqueta: string }[] = [
  { clave: "corriente", etiqueta: "Al corriente" },
  { clave: "d1_30", etiqueta: "1 a 30" },
  { clave: "d31_60", etiqueta: "31 a 60" },
  { clave: "d61_90", etiqueta: "61 a 90" },
  { clave: "mas_90", etiqueta: "Más de 90" },
];

export const TIPOS_GESTION: Record<string, string> = {
  llamada: "Llamada",
  correo: "Correo",
  whatsapp: "WhatsApp",
  visita: "Visita",
  aviso_legal: "Aviso legal",
  otro: "Otro",
};

const DIA = 86_400_000;

function ms(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((ms(hasta) - ms(desde)) / DIA);
}

export function sumarDias(iso: string, dias: number): string {
  return new Date(ms(iso) + dias * DIA).toISOString().slice(0, 10);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Externos = clientes que no son empresa del grupo; grupo = las que sí. */
export function filtrarClientes(docs: DocumentoCxc[], filtro: FiltroClientes): DocumentoCxc[] {
  if (filtro === "todos") return docs;
  return docs.filter((d) => (filtro === "grupo") === !!d.cliente_empresa_id);
}

export function diasVencido(doc: Pick<DocumentoCxc, "vence">, hoy: string): number {
  return Math.max(diasEntre(doc.vence, hoy), 0);
}

export function rangoDe(diasVencidos: number): RangoAntiguedad {
  if (diasVencidos <= 0) return "corriente";
  if (diasVencidos <= 30) return "d1_30";
  if (diasVencidos <= 60) return "d31_60";
  if (diasVencidos <= 90) return "d61_90";
  return "mas_90";
}

export interface EstatusDocumento {
  clave: "cobrado" | "vencido" | "corriente";
  texto: string;
  dias: number;
}

export function estatusDocumento(doc: DocumentoCxc, hoy: string): EstatusDocumento {
  if (doc.saldo <= 0.5) return { clave: "cobrado", texto: "Cobrado", dias: 0 };
  const dias = diasVencido(doc, hoy);
  if (dias > 0) return { clave: "vencido", texto: `Vencido ${dias} día${dias === 1 ? "" : "s"}`, dias };
  return { clave: "corriente", texto: "Al corriente", dias: 0 };
}

export interface Indicadores {
  cartera: number;
  documentos: number;
  vencida: number;
  pctVencida: number;
  vence30: number;
  diasPromedio: number;
  retenido: number;
  entreEmpresas: number;
}

/** Indicadores de la cartera filtrada; `entreEmpresas` suma lo que quedó fuera
 * del filtro por ser de empresas del grupo (para el pie "sin contar $X"). */
export function indicadores(docs: DocumentoCxc[], hoy: string, filtro: FiltroClientes = "externos"): Indicadores {
  const vivos = filtrarClientes(docs, filtro).filter((d) => d.saldo > 0.5);
  const en30 = sumarDias(hoy, 30);
  let cartera = 0, vencida = 0, vence30 = 0, retenido = 0, ponderado = 0;
  for (const d of vivos) {
    cartera += d.saldo;
    if (d.vence < hoy) vencida += d.saldo;
    else if (d.vence <= en30) vence30 += d.saldo;
    ponderado += d.saldo * Math.max(diasEntre(d.fecha, hoy), 0);
  }
  for (const d of docs) if (d.retenido > 0 && (filtro === "todos" || (filtro === "grupo") === !!d.cliente_empresa_id)) retenido += d.retenido;
  const entreEmpresas = filtro === "externos" ? docs.filter((d) => d.cliente_empresa_id && d.saldo > 0.5).reduce((s, d) => s + d.saldo, 0) : 0;
  return {
    cartera: r2(cartera),
    documentos: vivos.length,
    vencida: r2(vencida),
    pctVencida: cartera > 0 ? Math.round((vencida / cartera) * 100) : 0,
    vence30: r2(vence30),
    diasPromedio: cartera > 0 ? Math.round(ponderado / cartera) : 0,
    retenido: r2(retenido),
    entreEmpresas: r2(entreEmpresas),
  };
}

export interface FilaCliente {
  cliente_clave: string;
  cliente: string;
  empresas: string[];
  cliente_empresa: string | null;
  dias_credito: number | null;
  linea_credito: number | null;
  rangos: Record<RangoAntiguedad, number>;
  total: number;
  vencido: number;
  diasMax: number;
  documentos: number;
}

/** Una fila por cliente con su saldo por rango de antigüedad; primero el que más debe vencido. */
export function antiguedadPorCliente(docs: DocumentoCxc[], clientes: ClienteCxc[], hoy: string): FilaCliente[] {
  const porClave = new Map(clientes.map((c) => [c.clave, c]));
  const filas = new Map<string, FilaCliente>();
  for (const d of docs) {
    if (d.saldo <= 0.5) continue;
    let f = filas.get(d.cliente_clave);
    if (!f) {
      const c = porClave.get(d.cliente_clave);
      f = {
        cliente_clave: d.cliente_clave,
        cliente: c?.nombre ?? d.cliente,
        empresas: [],
        cliente_empresa: d.cliente_empresa,
        dias_credito: c?.dias_credito ?? null,
        linea_credito: c?.linea_credito ?? null,
        rangos: { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas_90: 0 },
        total: 0,
        vencido: 0,
        diasMax: 0,
        documentos: 0,
      };
      filas.set(d.cliente_clave, f);
    }
    if (!f.empresas.includes(d.empresa)) f.empresas.push(d.empresa);
    const dias = diasVencido(d, hoy);
    f.rangos[rangoDe(dias)] += d.saldo;
    f.total += d.saldo;
    if (dias > 0) f.vencido += d.saldo;
    f.diasMax = Math.max(f.diasMax, dias);
    f.documentos++;
  }
  const lista = [...filas.values()].map((f) => ({
    ...f,
    total: r2(f.total),
    vencido: r2(f.vencido),
    rangos: Object.fromEntries(Object.entries(f.rangos).map(([k, v]) => [k, r2(v)])) as FilaCliente["rangos"],
  }));
  lista.sort((a, b) => b.vencido - a.vencido || b.total - a.total || a.cliente.localeCompare(b.cliente));
  return lista;
}

export function totalesAntiguedad(filas: FilaCliente[]): Record<RangoAntiguedad | "total", number> {
  const t: Record<RangoAntiguedad | "total", number> = { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas_90: 0, total: 0 };
  for (const f of filas) {
    for (const r of RANGOS) t[r.clave] += f.rangos[r.clave];
    t.total += f.total;
  }
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = r2(t[k]);
  return t;
}

/** Última promesa vigente por cliente (fecha de promesa de hoy en adelante, o
 * ya vencida: entonces cuenta como incumplida mientras siga el saldo). */
export function promesaDe(gestiones: GestionCxc[], clave: string): GestionCxc | null {
  const con = gestiones.filter((g) => g.cliente_clave === clave && g.promesa_fecha).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  return con[0] ?? null;
}

export function lunesDe(iso: string): string {
  const d = new Date(ms(iso));
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return sumarDias(iso, -dow);
}

export interface SemanaCobranza {
  clave: string;
  etiqueta: string;
  monto: number;
  vencido?: boolean;
}

/** Cobranza esperada: "Ya vencido" + N semanas por fecha de vencimiento. Un
 * cliente con promesa de pago mueve lo vencido (hasta el monto prometido) a
 * la semana de la promesa; una promesa ya pasada se queda en vencido. */
export function cobranzaEsperada(docs: DocumentoCxc[], gestiones: GestionCxc[], hoy: string, semanas = 8): SemanaCobranza[] {
  const lunes = lunesDe(hoy);
  const cubos: SemanaCobranza[] = [{ clave: "vencido", etiqueta: "Ya vencido", monto: 0, vencido: true }];
  for (let i = 0; i < semanas; i++) {
    const ini = sumarDias(lunes, i * 7);
    cubos.push({ clave: ini, etiqueta: i === 0 ? "Esta semana" : `Sem. ${etiquetaCorta(ini)}`, monto: 0 });
  }
  const fin = sumarDias(lunes, semanas * 7);
  const restante = new Map<string, number>();
  const vivos = docs.filter((d) => d.saldo > 0.5).sort((a, b) => (a.vence < b.vence ? -1 : 1));
  for (const d of vivos) {
    let destino = d.vence < hoy ? "vencido" : d.vence < fin ? lunesDe(d.vence) : null;
    if (destino === "vencido") {
      const p = promesaDe(gestiones, d.cliente_clave);
      if (p?.promesa_fecha && p.promesa_fecha >= hoy && p.promesa_fecha < fin) {
        const queda = restante.has(d.cliente_clave) ? restante.get(d.cliente_clave)! : (p.promesa_monto ?? Number.POSITIVE_INFINITY);
        const mueve = Math.min(queda, d.saldo);
        if (mueve > 0) {
          const c = cubos.find((x) => x.clave === lunesDe(p.promesa_fecha!));
          if (c) c.monto += mueve;
          restante.set(d.cliente_clave, queda - mueve);
          if (d.saldo - mueve > 0.5) cubos[0].monto += d.saldo - mueve;
          continue;
        }
      }
    }
    if (destino === null) continue;
    const c = cubos.find((x) => x.clave === destino);
    if (c) c.monto += d.saldo;
  }
  for (const c of cubos) c.monto = r2(c.monto);
  return cubos;
}

function etiquetaCorta(iso: string): string {
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(iso.slice(8, 10))}-${meses[Number(iso.slice(5, 7)) - 1]}`;
}

export interface Aplicacion {
  doc: DocumentoCxc;
  aplica: number;
  queda: number;
}

/** El depósito se aplica primero a lo más vencido (fecha de vencimiento más
 * antigua); lo que sobra se reporta aparte. */
export function aplicarCobro(docs: DocumentoCxc[], monto: number): { aplicaciones: Aplicacion[]; sobrante: number } {
  let resto = Math.max(r2(monto), 0);
  const orden = docs.filter((d) => d.saldo > 0.5).sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : a.fecha < b.fecha ? -1 : 1));
  const aplicaciones = orden.map((doc) => {
    const aplica = r2(Math.min(resto, doc.saldo));
    resto = r2(resto - aplica);
    return { doc, aplica, queda: r2(doc.saldo - aplica) };
  });
  return { aplicaciones, sobrante: resto };
}

export interface ClienteAgenda {
  cliente_clave: string;
  cliente: string;
  vencido: number;
  diasMax: number;
  documentos: number;
  responsable: string | null;
  ultima: GestionCxc | null;
  promesa: GestionCxc | null;
  incumplida: boolean;
}

/** Clientes externos con saldo vencido, del más urgente al menos: primero las
 * promesas incumplidas, luego por días vencidos. */
export function agendaCobranza(docs: DocumentoCxc[], clientes: ClienteCxc[], gestiones: GestionCxc[], hoy: string): ClienteAgenda[] {
  const filas = antiguedadPorCliente(filtrarClientes(docs, "externos"), clientes, hoy).filter((f) => f.vencido > 0.5);
  const porClave = new Map(clientes.map((c) => [c.clave, c]));
  const lista = filas.map((f) => {
    const propias = gestiones.filter((g) => g.cliente_clave === f.cliente_clave).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const promesa = promesaDe(gestiones, f.cliente_clave);
    return {
      cliente_clave: f.cliente_clave,
      cliente: f.cliente,
      vencido: f.vencido,
      diasMax: f.diasMax,
      documentos: f.documentos,
      responsable: porClave.get(f.cliente_clave)?.responsable ?? null,
      ultima: propias[0] ?? null,
      promesa,
      incumplida: !!promesa?.promesa_fecha && promesa.promesa_fecha < hoy,
    };
  });
  lista.sort((a, b) => Number(b.incumplida) - Number(a.incumplida) || b.diasMax - a.diasMax || b.vencido - a.vencido);
  return lista;
}

export function textoGestion(g: GestionCxc, hoy: string): string {
  const base = `${TIPOS_GESTION[g.tipo] ?? g.tipo} el ${fechaLarga(g.fecha)}`;
  if (!g.promesa_fecha) return base;
  const incumplida = g.promesa_fecha < hoy;
  return `${base} · promesa del ${fechaLarga(g.promesa_fecha)}${incumplida ? " incumplida" : ""}`;
}

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "—";
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(iso.slice(8, 10)).toString().padStart(2, "0")} ${meses[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export interface ParEntreEmpresas {
  vende_id: string;
  vende: string;
  compra_id: string;
  compra: string;
  vendido: number;
  ov: number;
  comprado: number;
  oc: number;
  por_pagar: number;
  vencido: number;
  ov_sin_oc: string[];
}

export interface CuadrePar {
  par: ParEntreEmpresas;
  diferencia: number;
  cuadra: boolean;
  nota: string | null;
}

/** Lo que una empresa vendió a otra del grupo debe ser lo que la otra registró
 * como compra; ±$1 cuadra. */
export function cuadreEntreEmpresas(pares: ParEntreEmpresas[]): CuadrePar[] {
  return pares.map((par) => {
    const diferencia = r2(par.vendido - par.comprado);
    const cuadra = Math.abs(diferencia) <= 1;
    let nota: string | null = null;
    if (!cuadra && par.ov_sin_oc.length) {
      nota = `${par.compra} no ha registrado como OC ${par.ov_sin_oc.length === 1 ? "la venta" : "las ventas"} ${par.ov_sin_oc.join(", ")}`;
    } else if (!cuadra && diferencia > 0) {
      nota = `${par.compra} tiene registrado menos de lo que ${par.vende} le vendió`;
    } else if (!cuadra) {
      nota = `${par.compra} tiene registrado más de lo que ${par.vende} le vendió`;
    }
    return { par, diferencia, cuadra, nota };
  });
}

export function revisarDocumento(d: { folio: string; cliente_nombre: string; fecha: string; total: number; retenido: number; vence: string | null }): string | null {
  if (!d.folio.trim()) return "Falta el folio (p. ej. Estimación 4).";
  if (!d.cliente_nombre.trim()) return "Falta el cliente.";
  if (!d.fecha) return "Falta la fecha.";
  if (!(d.total > 0)) return "El total debe ser mayor a cero.";
  if (d.retenido < 0 || d.retenido > d.total) return "El retenido no puede pasar del total.";
  if (d.vence && d.vence < d.fecha) return "El vencimiento no puede ser antes de la fecha.";
  return null;
}
