// Personajes (18-oct-2026, Mario: "un avatar para todos, que se tomen su foto
// de frente para generarlo; una especie de NPC de videojuego con skills y
// trabajos pendientes, muy dinámico, de lo que deben avanzar durante el
// día"). Reglas puras: nivel por experiencia, clase según el puesto,
// habilidades, misiones del día, lo que dice el NPC, logros, y el filtro que
// vuelve la selfie pixel-art (sobre los bytes RGBA, sin DOM, para probarlo en
// node). La experiencia la calcula fn_personajes_stats en la base.

export interface StatsPersonaje {
  xp: number;
  tareas_terminadas: number;
  dias_checados: number;
  tarjetas_creadas: number;
  comentarios: number;
  cumplimiento_30: number | null;
  constancia_30: number | null;
  iniciativa_30: number;
  colaboracion_30: number;
  racha: number;
  checa: boolean;
  hechas_hoy: number;
  pendientes_hoy: number;
  vencidas: number;
}

export interface MisionTarea {
  id: string;
  titulo: string;
  tablero_id: string;
  tablero: string;
  fecha_limite: string | null;
  columna: string;
  papel: "responsable" | "corresponsable";
  vencida: boolean;
}

export interface HojaPersonaje {
  hoy: string;
  stats: StatsPersonaje;
  misiones: MisionTarea[];
  hechas_hoy: { id: string; titulo: string; tablero_id: string }[];
  proximas_7: number;
  sin_fecha: number;
  marcas_hoy: string[];
}

// --- Nivel ----------------------------------------------------------------------

/** XP acumulada para llegar al nivel n: 25·n·(n−1) (nivel 2 = 50, 3 = 150,
 * 4 = 300, 5 = 500, 10 = 2,250). Sube rápido al principio y luego cuesta. */
export function xpParaNivel(n: number): number {
  return 25 * n * (n - 1);
}

export function nivelDe(xp: number): { nivel: number; desde: number; hasta: number; progreso: number } {
  const total = Math.max(0, Math.floor(xp));
  let nivel = 1;
  while (xpParaNivel(nivel + 1) <= total) nivel++;
  const desde = xpParaNivel(nivel);
  const hasta = xpParaNivel(nivel + 1);
  return { nivel, desde, hasta, progreso: Math.round(((total - desde) / (hasta - desde)) * 100) };
}

export const RANGOS: [number, string][] = [
  [1, "Aprendiz"],
  [3, "Oficial"],
  [5, "Veterano"],
  [8, "Experto"],
  [12, "Maestro"],
  [16, "Leyenda"],
];

export function rangoDe(nivel: number): string {
  let r = RANGOS[0][1];
  for (const [n, nombre] of RANGOS) if (nivel >= n) r = nombre;
  return r;
}

// --- Clase (según el puesto) -------------------------------------------------------

export interface Clase {
  nombre: string;
  icono: string;
  /** Color de fondo del retrato. */
  color: string;
}

const CLASES: Record<string, Clase> = {
  admin: { nombre: "Gran estratega", icono: "👑", color: "#7c3aed" },
  direccion: { nombre: "Guardiana del tesoro", icono: "💰", color: "#ca8a04" },
  corporativo: { nombre: "Escriba del reino", icono: "📜", color: "#0e7490" },
  contabilidad: { nombre: "Escriba del reino", icono: "📜", color: "#0e7490" },
  tesoreria: { nombre: "Guardiana del tesoro", icono: "💰", color: "#ca8a04" },
  empresa: { nombre: "Gobernador", icono: "🏰", color: "#1d4ed8" },
  responsable: { nombre: "Maestro de obra", icono: "🏗️", color: "#c2410c" },
  supervisor: { nombre: "Capitán de obra", icono: "🦺", color: "#ea580c" },
  supervisor_bbva: { nombre: "Explorador", icono: "🧭", color: "#0f766e" },
  almacen: { nombre: "Intendente del almacén", icono: "📦", color: "#15803d" },
  produccion: { nombre: "Herrero de la planta", icono: "⚒️", color: "#57534e" },
  rh: { nombre: "Guardián del equipo", icono: "🛡️", color: "#be185d" },
  administrativo: { nombre: "Alquimista de oficina", icono: "🧪", color: "#4f46e5" },
  directivo: { nombre: "Consejero", icono: "🦉", color: "#6d28d9" },
  operativo: { nombre: "Constructor", icono: "🔨", color: "#b45309" },
};

export function claseDe(rol: string | null | undefined, modulos: string[] = []): Clase {
  if (rol === "corporativo" && modulos.includes("contabilidad")) return CLASES.contabilidad;
  if (rol === "corporativo" && modulos.includes("tesoreria")) return CLASES.tesoreria;
  return CLASES[rol ?? ""] ?? { nombre: "Aventurero", icono: "⭐", color: "#475569" };
}

// --- Habilidades ---------------------------------------------------------------------

export interface Habilidad {
  clave: string;
  nombre: string;
  /** 0 a 100; null = todavía sin datos. */
  valor: number | null;
  ayuda: string;
}

export function habilidades(s: StatsPersonaje): Habilidad[] {
  return [
    { clave: "cumplimiento", nombre: "Cumplimiento", valor: s.cumplimiento_30, ayuda: "tareas con fecha de los últimos 30 días que ya terminaste" },
    { clave: "constancia", nombre: "Constancia", valor: s.checa ? s.constancia_30 : null, ayuda: "días de los últimos 30 que checaste entrada" },
    { clave: "iniciativa", nombre: "Iniciativa", valor: s.iniciativa_30, ayuda: "tareas que tú creaste en 30 días (10 = barra llena)" },
    { clave: "colaboracion", nombre: "Colaboración", valor: s.colaboracion_30, ayuda: "comentarios en tarjetas en 30 días (20 = barra llena)" },
  ];
}

const ETIQUETA_OFICIO: Record<string, string> = {
  inventario: "Inventarios",
  produccion: "Producción",
  precios: "Precios unitarios",
  requisiciones: "Requisiciones",
  tareas: "Tareas",
  proyectos: "Obras",
  bbva: "BBVA",
  comedor: "Cocina",
  legal: "Legal",
  checador: "Asistencia",
  contabilidad: "Contabilidad",
  tesoreria: "Tesorería",
  punto_venta: "Mostrador",
  compras: "Compras",
  cotizador: "Cotizaciones",
  herramienta: "Herramienta",
  cumplimiento: "Cumplimiento",
};

/** Oficios desbloqueados: los módulos que la persona maneja. */
export function oficios(modulos: string[]): string[] {
  return [...new Set(modulos.map((m) => ETIQUETA_OFICIO[m]).filter(Boolean))] as string[];
}

// --- Misiones del día -------------------------------------------------------------

export interface Mision {
  clave: string;
  titulo: string;
  detalle: string;
  hecha: boolean;
  xp: number;
  urgente: boolean;
  liga?: string;
}

const PASOS_CHECADOR: [string, string][] = [
  ["entrada", "Checar entrada"],
  ["comida_inicio", "Salida a comer"],
  ["comida_fin", "Regreso de comer"],
  ["salida", "Checar salida"],
];

/** Lista del día: primero lo atrasado, luego el checador y lo que vence hoy,
 * y al final lo que ya se terminó hoy (tachado). */
export function misionesDelDia(h: HojaPersonaje): Mision[] {
  const lista: Mision[] = [];
  for (const t of h.misiones.filter((m) => m.vencida)) {
    lista.push({
      clave: `t-${t.id}`,
      titulo: t.titulo,
      detalle: `Atrasada desde ${fechaCorta(t.fecha_limite)} · ${t.tablero}`,
      hecha: false,
      xp: 10,
      urgente: true,
      liga: `/tareas/${t.tablero_id}?tarjeta=${t.id}`,
    });
  }
  if (h.stats.checa) {
    for (const [tipo, titulo] of PASOS_CHECADOR) {
      lista.push({ clave: `c-${tipo}`, titulo, detalle: "Checador", hecha: h.marcas_hoy.includes(tipo), xp: tipo === "entrada" ? 3 : 0, urgente: false, liga: "/checador" });
    }
  }
  for (const t of h.misiones.filter((m) => !m.vencida)) {
    lista.push({
      clave: `t-${t.id}`,
      titulo: t.titulo,
      detalle: `Vence hoy · ${t.tablero}${t.papel === "corresponsable" ? " · corresponsable" : ""}`,
      hecha: false,
      xp: 10,
      urgente: false,
      liga: `/tareas/${t.tablero_id}?tarjeta=${t.id}`,
    });
  }
  for (const t of h.hechas_hoy) {
    lista.push({ clave: `h-${t.id}`, titulo: t.titulo, detalle: "Terminada hoy", hecha: true, xp: 10, urgente: false, liga: `/tareas/${t.tablero_id}?tarjeta=${t.id}` });
  }
  return lista;
}

export function avanceDelDia(misiones: Mision[]): { hechas: number; total: number; pct: number; xpGanable: number } {
  const total = misiones.length;
  const hechas = misiones.filter((m) => m.hecha).length;
  return { hechas, total, pct: total ? Math.round((hechas / total) * 100) : 100, xpGanable: misiones.filter((m) => !m.hecha).reduce((s, m) => s + m.xp, 0) };
}

/** Lo que dice el NPC, según cómo va el día y la hora. */
export function dialogoNpc(nombre: string, misiones: Mision[], hora: number, s: StatsPersonaje): string {
  const pila = nombre.trim().split(/\s+/)[0] || "aventurero";
  const pendientes = misiones.filter((m) => !m.hecha);
  const atrasadas = pendientes.filter((m) => m.urgente);
  const saludo = hora < 12 ? "¡Buen día" : hora < 19 ? "¡Buena tarde" : "¡Buena noche";
  if (!misiones.length) return `${saludo}, ${pila}! Hoy no tienes misiones con fecha. Agrega una actividad o ayuda a tu equipo para ganar experiencia.`;
  if (!pendientes.length) return `¡Misión cumplida, ${pila}! Terminaste todo lo de hoy.${s.racha >= 3 ? ` Llevas ${s.racha} días seguidos: no rompas la racha.` : ""}`;
  if (atrasadas.length) {
    return `${pila}, tienes ${atrasadas.length} misión${atrasadas.length === 1 ? "" : "es"} atrasada${atrasadas.length === 1 ? "" : "s"}. Empieza por «${atrasadas[0].titulo}»: vale ${atrasadas[0].xp} XP.`;
  }
  const siguiente = pendientes[0];
  const hechas = misiones.length - pendientes.length;
  if (hechas === 0) return `${saludo}, ${pila}! Hoy tienes ${pendientes.length} misión${pendientes.length === 1 ? "" : "es"}. La primera: «${siguiente.titulo}».`;
  return `¡Vas bien, ${pila}! ${hechas} de ${misiones.length}. Sigue con «${siguiente.titulo}».`;
}

// --- Logros ---------------------------------------------------------------------------

export interface Logro {
  clave: string;
  nombre: string;
  icono: string;
  descripcion: string;
  logrado: boolean;
}

export function logros(s: StatsPersonaje, tieneAvatar: boolean): Logro[] {
  return [
    { clave: "avatar", nombre: "Tengo cara", icono: "🎭", descripcion: "Crear tu personaje con tu foto", logrado: tieneAvatar },
    { clave: "primera", nombre: "Primera misión", icono: "🥇", descripcion: "Terminar tu primera tarea", logrado: s.tareas_terminadas >= 1 },
    { clave: "diez", nombre: "Diez de diez", icono: "🔟", descripcion: "Terminar 10 tareas", logrado: s.tareas_terminadas >= 10 },
    { clave: "cincuenta", nombre: "Imparable", icono: "🚀", descripcion: "Terminar 50 tareas", logrado: s.tareas_terminadas >= 50 },
    { clave: "racha5", nombre: "Racha de 5", icono: "🔥", descripcion: "Checar entrada 5 días hábiles seguidos", logrado: s.racha >= 5 },
    { clave: "racha20", nombre: "Racha de 20", icono: "🌋", descripcion: "Checar entrada 20 días hábiles seguidos", logrado: s.racha >= 20 },
    { clave: "aldia", nombre: "Al día", icono: "✅", descripcion: "Sin tareas atrasadas", logrado: s.vencidas === 0 && s.tareas_terminadas > 0 },
    { clave: "lider", nombre: "Tomo la iniciativa", icono: "💡", descripcion: "Crear 10 tareas", logrado: s.tarjetas_creadas >= 10 },
    { clave: "equipo", nombre: "Jugador de equipo", icono: "🤝", descripcion: "20 comentarios en tarjetas", logrado: s.comentarios >= 20 },
  ];
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

// --- Pixel-art -------------------------------------------------------------------------

/** Paleta del retrato: tonos de piel, cabello y unos cuantos colores vivos. */
export const PALETA_PIXEL: [number, number, number][] = [
  [26, 22, 20], [58, 44, 36], [92, 64, 51], [43, 29, 20], [74, 47, 33], [107, 68, 48],
  [141, 90, 59], [176, 120, 80], [201, 148, 112], [224, 180, 140], [243, 212, 176], [252, 235, 214],
  [245, 245, 245], [200, 200, 205], [140, 144, 156], [80, 84, 96],
  [185, 28, 28], [234, 88, 12], [202, 138, 4], [21, 128, 61], [14, 116, 144], [29, 78, 216], [124, 58, 237], [190, 24, 93],
];

function cercano(r: number, g: number, b: number, paleta: [number, number, number][]): [number, number, number] {
  let mejor = paleta[0];
  let dist = Infinity;
  for (const p of paleta) {
    // Distancia con peso perceptual simple (el ojo nota más el verde).
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < dist) {
      dist = d;
      mejor = p;
    }
  }
  return mejor;
}

/** Vuelve pixel-art un retrato ya reducido (lado × lado, RGBA): sube el
 * contraste, lo lleva a la paleta, recorta en óvalo (fuera queda
 * transparente) y le pone contorno oscuro como sprite. Devuelve bytes nuevos. */
export function pixelar(datos: Uint8ClampedArray, lado: number, opciones: { contraste?: number; paleta?: [number, number, number][] } = {}): Uint8ClampedArray {
  const paleta = opciones.paleta ?? PALETA_PIXEL;
  const contraste = opciones.contraste ?? 1.25;
  const sal = new Uint8ClampedArray(datos.length);
  const cx = (lado - 1) / 2;
  const radioX = lado * 0.46;
  const radioY = lado * 0.5;
  const dentro = (x: number, y: number) => ((x - cx) / radioX) ** 2 + ((y - cx) / radioY) ** 2 <= 1;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const i = (y * lado + x) * 4;
      if (!dentro(x, y)) {
        sal[i + 3] = 0;
        continue;
      }
      const ajusta = (v: number) => Math.max(0, Math.min(255, (v - 128) * contraste + 128));
      const [r, g, b] = cercano(ajusta(datos[i]), ajusta(datos[i + 1]), ajusta(datos[i + 2]), paleta);
      sal[i] = r;
      sal[i + 1] = g;
      sal[i + 2] = b;
      sal[i + 3] = 255;
    }
  }
  // Contorno: todo pixel visible con un vecino transparente se oscurece.
  const opaco = (x: number, y: number) => x >= 0 && y >= 0 && x < lado && y < lado && sal[(y * lado + x) * 4 + 3] > 0;
  const borde: number[] = [];
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      if (opaco(x, y) && (!opaco(x - 1, y) || !opaco(x + 1, y) || !opaco(x, y - 1) || !opaco(x, y + 1))) borde.push((y * lado + x) * 4);
    }
  }
  for (const i of borde) {
    sal[i] = 20;
    sal[i + 1] = 18;
    sal[i + 2] = 24;
  }
  return sal;
}

/** Recorte cuadrado centrado de una imagen (para la selfie de frente). */
export function recorteCentral(ancho: number, alto: number, zoom = 1): { x: number; y: number; lado: number } {
  const lado = Math.round(Math.min(ancho, alto) / Math.max(1, zoom));
  // La cara suele quedar un poco arriba del centro.
  const y = Math.max(0, Math.min(alto - lado, Math.round((alto - lado) / 2 - lado * 0.06)));
  return { x: Math.round((ancho - lado) / 2), y, lado };
}
