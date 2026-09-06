import { PDFFont } from "npm:pdf-lib@1.17.1";

// Helvetica estándar sólo codifica WinAnsi (Latin-1). Los acentos y la ñ sí
// entran; las comillas tipográficas y las rayas largas que se cuelan al copiar
// de Word NO, y pdf-lib revienta con ellas en vez de ignorarlas. Se normalizan
// antes de dibujar cualquier texto.
const SUSTITUCIONES: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ",
  "′": "'", "″": '"', "−": "-",
};

export function limpio(texto: unknown): string {
  const s = String(texto ?? "");
  let salida = "";
  for (const c of s.normalize("NFC")) {
    if (SUSTITUCIONES[c]) salida += SUSTITUCIONES[c];
    else if (c.codePointAt(0)! <= 0xff) salida += c;
    else salida += "?";
  }
  return salida;
}

export function moneda(n: unknown): string {
  const v = Number(n ?? 0);
  const signo = v < 0 ? "-" : "";
  const [ent, dec] = Math.abs(v).toFixed(2).split(".");
  return `${signo}$${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}

export function numero(n: unknown, decimales = 4): string {
  const v = Number(n ?? 0);
  const fijo = v.toFixed(decimales).replace(/0+$/, "").replace(/\.$/, "");
  const [ent, dec] = fijo.split(".");
  return ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec ? `.${dec}` : "");
}

export function porcentaje(fraccion: unknown): string {
  return `${(Number(fraccion ?? 0) * 100).toFixed(2)}%`;
}

export function fechaCorta(valor: unknown): string {
  if (!valor) return "";
  const d = new Date(String(valor));
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Parte un texto en las líneas que caben en `ancho`. Si una sola palabra no
// cabe (un código largo sin espacios), se corta a la fuerza en vez de
// desbordarse sobre la columna vecina.
export function envolver(texto: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  const palabras = limpio(texto).split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";

  const cabe = (s: string) => fuente.widthOfTextAtSize(s, tam) <= ancho;

  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (cabe(candidata)) {
      actual = candidata;
      continue;
    }
    if (actual) lineas.push(actual);

    let resto = palabra;
    while (!cabe(resto) && resto.length > 1) {
      let corte = resto.length;
      while (corte > 1 && !cabe(resto.slice(0, corte))) corte--;
      lineas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    actual = resto;
  }

  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}
