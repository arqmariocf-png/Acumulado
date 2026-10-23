// Ligas que se pueden abrir con un clic en comentarios y notas (21-oct-2026,
// Maria Fernanda: "en comentarios pongo links pero se tiene que copiar todo y
// pegar"). Parte un texto en pedazos de texto y de liga; solo http(s) y
// "www." (nunca javascript: ni data:). La puntuación final (punto, coma,
// paréntesis sin pareja) no se come la liga. Puro, con pruebas.

export type Pedazo = { tipo: "texto"; texto: string } | { tipo: "liga"; texto: string; url: string };

const PATRON = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function recortarFinal(liga: string): string {
  let s = liga;
  for (;;) {
    const ult = s[s.length - 1];
    if (!ult) return s;
    if (".,;:!?¡¿…\"'»".includes(ult)) {
      s = s.slice(0, -1);
      continue;
    }
    if (ult === ")" && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) {
      s = s.slice(0, -1);
      continue;
    }
    return s;
  }
}

export function partirEnlaces(texto: string | null | undefined): Pedazo[] {
  if (!texto) return [];
  const pedazos: Pedazo[] = [];
  let desde = 0;
  for (const m of texto.matchAll(PATRON)) {
    const liga = recortarFinal(m[0]);
    const i = m.index ?? 0;
    if (liga.length < 5 || liga.toLowerCase() === "www.") continue;
    if (i > desde) pedazos.push({ tipo: "texto", texto: texto.slice(desde, i) });
    const url = /^https?:\/\//i.test(liga) ? liga : `https://${liga}`;
    pedazos.push({ tipo: "liga", texto: liga, url });
    desde = i + liga.length;
  }
  if (desde < texto.length) pedazos.push({ tipo: "texto", texto: texto.slice(desde) });
  return pedazos;
}

export function ligasDe(texto: string | null | undefined): string[] {
  return partirEnlaces(texto).flatMap((p) => (p.tipo === "liga" ? [p.url] : []));
}
