// Mensaje de la semana de Mario (17-oct-2026, Mario: "genérame frases de
// este tipo y las elijo semana con semana"): banco de agradecimientos para
// el equipo y fechas del sábado de envío. Puro (sin DOM) para probarlo en node.

export const LIMITE_MENSAJE = 300;

export const FRASES_AGRADECIMIENTO: string[] = [
  "Gracias por el esfuerzo de esta semana. Cada obra que avanza es gracias a ustedes. ¡Buen fin de semana!",
  "Termina otra semana de trabajo duro. Gracias por su compromiso y por cuidar cada detalle. Descansen.",
  "Gracias a todo el equipo: en obra, en almacén y en oficina. Lo que construimos juntos se nota. ¡Buen descanso!",
  "Esta semana se lograron cosas importantes gracias a ustedes. Gracias por dar lo mejor. Disfruten a su familia.",
  "Gracias por su puntualidad, su orden y su buena actitud. Así se hace equipo. ¡Nos vemos el lunes!",
  "Cada requisición atendida, cada tarea cerrada y cada entrega a tiempo suma. Gracias por esta semana.",
  "Gracias por cuidarse y cuidar a sus compañeros en la obra. La seguridad primero, siempre. Buen fin de semana.",
  "Reconozco el trabajo de cada uno de ustedes. Gracias por sacar adelante los pendientes de la semana.",
  "Una semana más cumpliendo. Gracias por su dedicación; descansen y regresen con energía el lunes.",
  "Gracias por resolver, por apoyar y por no rendirse cuando las cosas se complican. Orgulloso de este equipo.",
  "Gracias por su trabajo de esta semana. Lo que hacemos bien hoy es la confianza de nuestros clientes mañana.",
  "Gracias por mantener el sistema al día: checador, tareas y requisiciones. Eso nos hace más fuertes. ¡Buen descanso!",
  "Esta semana demostramos que juntos llegamos más lejos. Gracias a cada uno por su parte.",
  "Gracias por su esfuerzo y por su compromiso con la calidad. Disfruten su fin de semana.",
  "Gracias por estar, por sumar y por hacer bien las cosas. Descansen, se lo ganaron.",
  "Cada semana aprendemos y mejoramos. Gracias por su paciencia y por su trabajo en equipo.",
  "Gracias a quienes madrugaron, a quienes se quedaron un poco más y a todos los que dieron extra esta semana.",
  "Gracias por representar a Grupo Loma con orgullo en cada obra. ¡Buen fin de semana!",
  "Lo que se construye con esfuerzo, dura. Gracias por esta semana de trabajo. Descansen.",
  "Gracias por su honestidad y su entrega. Son la base de lo que somos. ¡Nos vemos el lunes!",
  "Una semana más, un paso más. Gracias por caminar juntos en cada proyecto.",
  "Gracias por atender con buena cara, resolver a tiempo y apoyarse entre todos. Así sí se puede.",
  "Gracias por el trabajo de esta semana. Recuerden: la familia también es prioridad. Disfrútenla.",
  "Cerramos la semana con resultados. Gracias a cada persona del equipo; sin ustedes no sería posible.",
  "Gracias por su constancia. Los grandes proyectos se hacen día a día, como ustedes lo hacen.",
  "Gracias por su compromiso y su responsabilidad. Que tengan un excelente descanso.",
  "Esta semana hubo retos y los sacamos adelante. Gracias por no bajar los brazos.",
  "Gracias por cuidar el material, la herramienta y el tiempo de todos. Eso también es construir.",
  "Gracias por la confianza y por el trabajo de cada día. Descansen y regresen con todo el lunes.",
  "A todo el equipo: gracias. Su esfuerzo de esta semana se ve en cada avance. ¡Buen fin de semana!",
];

/** Hoy (AAAA-MM-DD) si es sábado; si no, el siguiente sábado. */
export function proximoSabado(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Los siguientes `n` sábados a partir de hoy (incluido hoy si es sábado). */
export function sabadosSiguientes(hoy: string, n: number): string[] {
  const primero = proximoSabado(hoy);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${primero}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    return d.toISOString().slice(0, 10);
  });
}

/** Una frase distinta para cada semana del año, para sugerir sin repetir. */
export function fraseSugerida(sabado: string, frases: string[] = FRASES_AGRADECIMIENTO): string {
  const d = new Date(`${sabado}T12:00:00Z`);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  const semana = Math.floor((d.getTime() - inicio) / (7 * 86_400_000));
  return frases[semana % frases.length];
}

/** Frases que no se han usado (sin importar mayúsculas ni espacios). */
export function frasesSinUsar(usadas: string[], frases: string[] = FRASES_AGRADECIMIENTO): string[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const ya = new Set(usadas.map(norm));
  return frases.filter((f) => !ya.has(norm(f)));
}

/** ¿Ya pasó la hora de envío (sábado 13:00 hora de México) de ese sábado? */
export function yaPasoEnvio(sabado: string, ahora: Date = new Date()): boolean {
  // México: UTC-6 todo el año (sin horario de verano desde 2022).
  return ahora.getTime() >= Date.parse(`${sabado}T19:00:00Z`);
}
