// CRM de ventas por WhatsApp y redes (17-oct-2026, Mario: "módulo de ventas
// a través de redes sociales y de WhatsApp; un CRM de atención que genere
// las cotizaciones de manera automática"; decidió que la cotización la
// revisa una persona antes de enviarse y empezar con Clavicón y AEP).
//
// Aquí: leer el mensaje del cliente ("ocupo 10 rollos de malla 10.5 y 5
// bultos de cemento") y proponer las partidas con los productos de la
// empresa; el texto de WhatsApp de la cotización; etapas del embudo y quién
// espera respuesta. Puro (sin DOM) para probarlo en node. No usa IA: reglas
// fijas sobre el catálogo, así funciona aunque no haya clave de Anthropic.

import { normalizarBusqueda } from "./buscadorCaptura.ts";
import type { ProductoCotizador } from "./cotizador.ts";

export type EtapaCrm = "nuevo" | "cotizado" | "negociacion" | "ganado" | "perdido";
export type CanalCrm = "whatsapp" | "facebook" | "instagram" | "telefono" | "otro";

export const ETAPAS_CRM: EtapaCrm[] = ["nuevo", "cotizado", "negociacion", "ganado", "perdido"];
export const ETIQUETA_ETAPA_CRM: Record<EtapaCrm, string> = {
  nuevo: "Nuevo",
  cotizado: "Cotizado",
  negociacion: "En negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};
export const CLASE_ETAPA_CRM: Record<EtapaCrm, string> = {
  nuevo: "bg-sky-50 text-sky-700",
  cotizado: "bg-amber-100 text-amber-800",
  negociacion: "bg-violet-50 text-violet-700",
  ganado: "bg-emerald-50 text-emerald-700",
  perdido: "bg-slate-100 text-slate-500",
};
export const ETIQUETA_CANAL: Record<CanalCrm, string> = {
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
  telefono: "Teléfono",
  otro: "Otro",
};

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, docena: 12, media: 0.5,
};

/** Unidad escrita por el cliente → unidad del sistema. */
const UNIDADES: Record<string, string> = {
  rollo: "rollo", rollos: "rollo",
  bulto: "bulto", bultos: "bulto", saco: "bulto", sacos: "bulto",
  pieza: "pza", piezas: "pza", pza: "pza", pzas: "pza", pz: "pza",
  kilo: "kg", kilos: "kg", kg: "kg", kgs: "kg",
  metro: "m", metros: "m", mts: "m", mt: "m", m: "m",
  tramo: "tramo", tramos: "tramo",
  caja: "caja", cajas: "caja",
  cubeta: "cubeta", cubetas: "cubeta",
  litro: "lt", litros: "lt", lt: "lt", lts: "lt",
  tonelada: "ton", toneladas: "ton", ton: "ton",
  juego: "juego", juegos: "juego",
  rollito: "rollo",
};

/** Palabras que no dicen qué producto es. */
const RELLENO = new Set(
  "hola buenas buenos dias tardes noches buen dia que tal me puede puedes podria podrian dar pasar mandar enviar cotizar cotizacion cotizame precio precios costo costos cuanto cuanta cuantos cuesta cuestan sale salen necesito necesitamos ocupo ocupamos requiero requerimos quiero queremos quisiera favor por gracias de del la el los las al a para con en mi su sus un una unos unas y o e es son hay tienen tiene manejan venden disponible disponibles existencia porfa pls please saludos atentamente seria serian aprox aproximadamente mas".split(" "),
);

export interface RenglonInterpretado {
  /** Lo que escribió el cliente para este renglón. */
  texto: string;
  cantidad: number;
  unidad: string | null;
  producto: ProductoCotizador | null;
  /** Otras opciones parecidas (para elegir si el sistema dudó). */
  alternativas: ProductoCotizador[];
  /** 0 a 1: qué tanto se parece al producto elegido. */
  confianza: number;
}

/** Parte el mensaje en renglones: saltos de línea, comas, punto y coma, "+" y
 * " y " antes de un número ("10 rollos y 5 bultos"). */
export function partirPedido(texto: string): string[] {
  return texto
    .replace(/\r/g, "")
    .split(/\n|;|,(?!\d)|\+|\s+y\s+(?=(?:\d|un[oa]?\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b|nueve\b|diez\b|media\b|docena\b))/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cantidad, unidad y palabras del producto de un renglón. */
export function leerRenglon(texto: string): { cantidad: number | null; unidad: string | null; palabras: string[] } {
  const tokens = texto
    .replace(/(\d),(\d)/g, "$1.$2")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s/]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let cantidad: number | null = null;
  let unidad: string | null = null;
  const palabras: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pegado = t.match(/^(\d+(?:\.\d+)?)([a-z]+)$/); // "10kg", "5rollos"
    if (cantidad == null && pegado && UNIDADES[pegado[2]]) {
      cantidad = Number(pegado[1]);
      unidad = UNIDADES[pegado[2]];
      continue;
    }
    if (cantidad == null && /^\d+(\.\d+)?$/.test(t) && UNIDADES[tokens[i + 1] ?? ""]) {
      cantidad = Number(t);
      continue;
    }
    if (cantidad == null && NUMEROS[t] != null && (UNIDADES[tokens[i + 1] ?? ""] || /^\d/.test(tokens[i + 1] ?? "") === false)) {
      if (t === "media" && tokens[i + 1] === "docena") {
        cantidad = 6;
        i++;
        continue;
      }
      cantidad = NUMEROS[t];
      continue;
    }
    if (unidad == null && UNIDADES[t] && (cantidad != null || i === 0)) {
      unidad = UNIDADES[t];
      continue;
    }
    if (cantidad == null && /^\d+(\.\d+)?$/.test(t) && palabras.length === 0) {
      cantidad = Number(t); // "10 malla …" sin unidad
      continue;
    }
    if (RELLENO.has(t) || t.length < 2) continue;
    palabras.push(t.replace(/s$/, (m) => (t.length > 4 ? "" : m)));
  }
  return { cantidad, unidad, palabras };
}

/** Qué tanto se parece lo que pidió a un producto (0 a 1). Las medidas
 * ("10.5", "3/8") pesan doble: distinguen productos con el mismo nombre. */
export function parecido(palabras: string[], producto: ProductoCotizador): number {
  if (!palabras.length) return 0;
  const clave = ` ${producto.clave} `;
  let total = 0;
  let cuenta = 0;
  for (const original of palabras) {
    const p = normalizarBusqueda(original);
    const peso = /\d/.test(p) ? 2 : 1;
    total += peso;
    const raiz = p.length > 5 ? p.slice(0, -1) : p;
    if (clave.includes(` ${p} `) || clave.includes(` ${p}s `) || (raiz.length >= 4 && clave.includes(` ${raiz}`))) cuenta += peso;
  }
  return total ? cuenta / total : 0;
}

/** Lee el mensaje y propone una partida por renglón con el producto más
 * parecido (si se parece al menos a la mitad); lo demás queda para que el
 * vendedor elija. */
export function interpretarPedido(texto: string, productos: ProductoCotizador[]): RenglonInterpretado[] {
  const salida: RenglonInterpretado[] = [];
  for (const parte of partirPedido(texto)) {
    const { cantidad, unidad, palabras } = leerRenglon(parte);
    if (!palabras.length) continue; // saludo, "gracias", etc.
    const ranking = productos
      .map((p) => ({ p, s: parecido(palabras, p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.p.veces - a.p.veces);
    const mejor = ranking[0] && ranking[0].s >= 0.5 ? ranking[0] : null;
    salida.push({
      texto: parte,
      cantidad: cantidad ?? 1,
      unidad: unidad ?? mejor?.p.unidad ?? null,
      producto: mejor?.p ?? null,
      alternativas: ranking.filter((x) => x.p !== mejor?.p).slice(0, 4).map((x) => x.p),
      confianza: mejor?.s ?? 0,
    });
  }
  return salida;
}

/** Teléfono para wa.me: solo dígitos y, si es celular de 10 dígitos, con 52. */
export function telefonoWhatsapp(telefono: string | null | undefined): string | null {
  const d = (telefono ?? "").replace(/\D/g, "");
  if (d.length === 10) return `52${d}`;
  if (d.length >= 11) return d;
  return null;
}

export function enlaceWhatsapp(telefono: string | null | undefined, texto: string): string {
  const num = telefonoWhatsapp(telefono);
  return `https://wa.me/${num ?? ""}?text=${encodeURIComponent(texto)}`;
}

const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Texto de la cotización para mandar por WhatsApp (precios con IVA). */
export function mensajeCotizacion(c: {
  empresa: string;
  folio: string;
  cliente: string;
  vigenciaDias: number;
  lineas: { descripcion: string; cantidad: number; unidad: string; precio_unitario: number }[];
  vendedor?: string | null;
}): string {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const partidas = c.lineas.map((l) => {
    const unitario = r2(l.precio_unitario * 1.16);
    return `• ${l.cantidad} ${l.unidad} ${l.descripcion}: ${pesos(unitario)} c/u = ${pesos(r2(unitario * l.cantidad))}`;
  });
  const subtotal = r2(c.lineas.reduce((s, l) => s + l.precio_unitario * l.cantidad, 0));
  const total = r2(subtotal * 1.16);
  return [
    `Hola ${c.cliente.split(" ")[0]}, gracias por escribirnos a ${c.empresa}.`,
    `Te comparto la cotización ${c.folio}:`,
    ...partidas,
    `Subtotal ${pesos(subtotal)} + IVA ${pesos(r2(total - subtotal))}`,
    `*Total ${pesos(total)}* (precios con IVA, vigencia ${c.vigenciaDias} días).`,
    "¿Te la confirmo para preparar tu pedido?",
    c.vendedor ? `— ${c.vendedor}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ProspectoResumen {
  etapa: EtapaCrm;
  ultimo_entrante_en: string | null;
  ultimo_saliente_en: string | null;
}

/** Espera respuesta: el último mensaje es del cliente y no se ha cerrado. */
export function esperaRespuesta(p: ProspectoResumen): boolean {
  if (p.etapa === "ganado" || p.etapa === "perdido" || !p.ultimo_entrante_en) return false;
  return !p.ultimo_saliente_en || p.ultimo_entrante_en > p.ultimo_saliente_en;
}

/** Minutos que lleva esperando (para el semáforo: ámbar ≥30 min, rojo ≥2 h). */
export function minutosEsperando(p: ProspectoResumen, ahora: Date = new Date()): number | null {
  if (!esperaRespuesta(p)) return null;
  return Math.max(0, Math.round((ahora.getTime() - Date.parse(p.ultimo_entrante_en!)) / 60_000));
}
