// Importe con letra para el pie de la tarjeta. Es requisito de forma en un
// análisis de precio unitario: la cifra con letra es la que prevalece si el
// número impreso queda ilegible o alterado.

const UNIDADES = [
  "", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES",
  "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];

const DECENAS = [
  "", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA",
  "SESENTA", "SETENTA", "OCHENTA", "NOVENTA",
];

const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

function decenas(n: number): string {
  if (n < 30) return UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return DECENAS[d] + (u > 0 ? " Y " + UNIDADES[u] : "");
}

function centenas(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const cabeza = CENTENAS[c];
  if (r === 0) return cabeza;
  return cabeza ? cabeza + " " + decenas(r) : decenas(r);
}

function entero(n: number): string {
  if (n === 0) return "CERO";

  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones === 1) partes.push("UN MILLON");
  else if (millones > 1) partes.push(entero(millones) + " MILLONES");

  if (miles === 1) partes.push("MIL");
  else if (miles > 1) partes.push(centenas(miles) + " MIL");

  if (resto > 0) partes.push(centenas(resto));

  return partes.join(" ");
}

export function importeConLetra(valor: number): string {
  // Se trabaja en centavos para que 1055.695 no se parta en "1055" y "70".
  const centavos = Math.round(Math.abs(valor) * 100);
  const pesos = Math.floor(centavos / 100);
  const fraccion = centavos % 100;

  // "VEINTIUNO PESOS" no se dice: apocopa a "VEINTIUN".
  const letras = entero(pesos).replace(/UNO$/, "UN");
  const signo = valor < 0 ? "MENOS " : "";

  return `${signo}${letras} PESOS ${String(fraccion).padStart(2, "0")}/100 M.N.`;
}
