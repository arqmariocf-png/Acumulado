// Ficha técnica de la vigueta que produce Balken (5-nov-2026, Mario: "generemos
// una ficha técnica de la vigueta que estamos produciendo para agregarlo al
// cotizador de Balken"). Vigueta armada: 3 varillas, 2 en el patín inferior y
// 1 superior, unidas con celosía de alambrón, coladas en charola de 12 m con
// concreto premezclado f'c 200. Dos versiones (5-nov-2026, Mario: "la varilla
// es de 1/2" porque es la versión reforzada, esa que generaste es la sencilla y
// se sugiere hasta claros máximos de 3 m, la demás sería reforzada"):
// sencilla = varilla 3/8", claros hasta 3 m; reforzada = varilla 1/2", claros
// mayores. Los datos de cada ficha se editan en pantalla y se recuerdan en el
// navegador; el acero y el peso se calculan de la armadura. Puro, sin DOM: se
// prueba en node.

/** Peso por metro (kg/m) de varilla corrugada y alambrón por calibre. */
export const PESO_KG_M: Record<string, number> = {
  '1/4"': 0.248,
  '5/16"': 0.384,
  '3/8"': 0.557,
  '1/2"': 0.994,
  "5.5 mm": 0.187,
  "6.0 mm": 0.222,
};
export const CALIBRES_VARILLA = ['5/16"', '3/8"', '1/2"'];
export const CALIBRES_CELOSIA = ['1/4"', "5.5 mm", "6.0 mm"];

export type VersionVigueta = "sencilla" | "reforzada";
export const VERSIONES_VIGUETA: VersionVigueta[] = ["sencilla", "reforzada"];
export const NOMBRE_VERSION: Record<VersionVigueta, string> = { sencilla: "Vigueta sencilla", reforzada: "Vigueta reforzada" };

export interface FichaVigueta {
  version: VersionVigueta;
  nombre: string;
  /** Peralte de la vigueta (cm). */
  peralte: number;
  /** Ancho del patín inferior (cm). */
  anchoPatin: number;
  /** Ancho del alma / parte superior (cm). */
  anchoAlma: number;
  /** Sección de concreto (cm²). */
  seccionCm2: number;
  /** Largo máximo de fabricación (m): la charola. */
  largoMaximo: number;
  /** Cortes a medida en múltiplos de (cm). */
  multiploCorte: number;
  /** Resistencia del concreto (kg/cm²). */
  fcConcreto: number;
  concretoTexto: string;
  /** Varillas inferiores: cuántas y calibre. */
  varillasInferiores: number;
  calibreInferior: string;
  /** Varillas superiores. */
  varillasSuperiores: number;
  calibreSuperior: string;
  gradoVarilla: string;
  /** Celosía: calibre del alambrón y metros de alambrón por metro de vigueta. */
  calibreCelosia: string;
  celosiaMetrosPorMetro: number;
  /** Sistema de losa con el que se usa. */
  separacionEjes: number;
  bovedilla: string;
  capaCompresion: number;
  mallaCapa: string;
  /** Claro a partir del cual se recomienda esta versión (m); 0 = desde cualquier claro. */
  claroDesde: number;
  claroMaximo: number;
  /** Carga de servicio para la que se recomienda (kg/m²), 0 = por confirmar. */
  cargaServicio: number;
  apoyoMinimo: number;
  apuntalamiento: string;
  usos: string;
  manejo: string;
  normas: string;
  /** Lo que Mario o Jaime quieran agregar. */
  notas: string;
}

/** Versión sencilla: varilla 3/8", claros hasta 3 m. */
export const FICHA_SENCILLA: FichaVigueta = {
  version: "sencilla",
  nombre: "Vigueta sencilla Balken V-12",
  peralte: 12,
  anchoPatin: 12,
  anchoAlma: 8,
  seccionCm2: 100,
  largoMaximo: 12,
  multiploCorte: 10,
  fcConcreto: 200,
  concretoTexto: "Concreto premezclado, agregado máximo 3/8\", colado en charola metálica y curado húmedo",
  varillasInferiores: 2,
  calibreInferior: '3/8"',
  varillasSuperiores: 1,
  calibreSuperior: '3/8"',
  gradoVarilla: "Grado 42 (fy = 4,200 kg/cm²)",
  calibreCelosia: '1/4"',
  celosiaMetrosPorMetro: 1.4,
  separacionEjes: 0.7,
  bovedilla: "Bovedilla de cemento 15×25×56",
  capaCompresion: 5,
  mallaCapa: "Malla electrosoldada 6-6/10-10",
  claroDesde: 0,
  claroMaximo: 3,
  cargaServicio: 0,
  apoyoMinimo: 10,
  apuntalamiento: "Puntales a cada 1.50 m como máximo, con contraflecha de 1 cm por cada metro de claro; se retiran cuando la capa de compresión alcanza su resistencia (14 días con cemento normal).",
  usos: "Losas de entrepiso y azotea en vivienda, comercio y naves ligeras, con bovedilla de cemento o de poliestireno; claros cortos (hasta 3 m).",
  manejo: "Estibar sobre polines a 1/5 del largo por cada extremo, con el patín (varillas inferiores) hacia abajo. Izar siempre por los extremos; nunca al centro.",
  normas: "NMX-C-406-ONNCCE (sistemas de vigueta y bovedilla) · NMX-B-506 (varilla corrugada) · NMX-C-155 (concreto hidráulico).",
  notas: "",
};

/** Versión reforzada: varilla 1/2", para claros mayores a 3 m. */
export const FICHA_REFORZADA: FichaVigueta = {
  ...FICHA_SENCILLA,
  version: "reforzada",
  nombre: "Vigueta reforzada Balken V-12",
  calibreInferior: '1/2"',
  calibreSuperior: '1/2"',
  claroDesde: 3,
  claroMaximo: 3.5,
  usos: "Losas de entrepiso y azotea en vivienda, comercio y naves ligeras, con bovedilla de cemento o de poliestireno; claros mayores a 3 m.",
};

export const FICHAS_VIGUETA: Record<VersionVigueta, FichaVigueta> = { sencilla: FICHA_SENCILLA, reforzada: FICHA_REFORZADA };
/** La ficha de siempre (compatibilidad): la sencilla. */
export const FICHA_BASE = FICHA_SENCILLA;

/** Qué versión toca según el claro (m): hasta el claro máximo de la sencilla, sencilla; más, reforzada. */
export function versionPorClaro(claro: number, fichas: Record<VersionVigueta, FichaVigueta> = FICHAS_VIGUETA): VersionVigueta {
  return claro <= fichas.sencilla.claroMaximo + 1e-9 ? "sencilla" : "reforzada";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface AceroVigueta {
  /** kg/m de las varillas (inferiores + superiores). */
  varillasKgM: number;
  /** kg/m de la celosía. */
  celosiaKgM: number;
  totalKgM: number;
  /** Cuántas varillas lleva la vigueta. */
  varillas: number;
  descripcion: string;
}

/** Acero por metro de vigueta a partir de la armadura. */
export function aceroVigueta(f: FichaVigueta): AceroVigueta {
  const inf = f.varillasInferiores * (PESO_KG_M[f.calibreInferior] ?? 0);
  const sup = f.varillasSuperiores * (PESO_KG_M[f.calibreSuperior] ?? 0);
  const celosia = f.celosiaMetrosPorMetro * (PESO_KG_M[f.calibreCelosia] ?? 0);
  const varillas = f.varillasInferiores + f.varillasSuperiores;
  const partes = [
    f.varillasInferiores > 0 ? `${f.varillasInferiores} × ${f.calibreInferior} inferior${f.varillasInferiores === 1 ? "" : "es"}` : "",
    f.varillasSuperiores > 0 ? `${f.varillasSuperiores} × ${f.calibreSuperior} superior${f.varillasSuperiores === 1 ? "" : "es"}` : "",
  ].filter(Boolean);
  return {
    varillasKgM: r2(inf + sup),
    celosiaKgM: r2(celosia),
    totalKgM: r2(inf + sup + celosia),
    varillas,
    descripcion: `${varillas} varilla${varillas === 1 ? "" : "s"} (${partes.join(" + ")}) con celosía de alambrón ${f.calibreCelosia}`,
  };
}

/** Peso aproximado por metro: concreto a 2,400 kg/m³ más el acero. */
export function pesoVigueta(f: FichaVigueta): { concretoKgM: number; aceroKgM: number; totalKgM: number } {
  const concreto = (f.seccionCm2 / 10000) * 2400;
  const acero = aceroVigueta(f).totalKgM;
  return { concretoKgM: r2(concreto), aceroKgM: acero, totalKgM: r2(concreto + acero) };
}

/** Costo del acero por metro con los precios dados ($/kg sin IVA). */
export function costoAceroPorMetro(f: FichaVigueta, precioVarillaKg: number, precioAlambronKg: number): number {
  const a = aceroVigueta(f);
  return r2(a.varillasKgM * precioVarillaKg + a.celosiaKgM * precioAlambronKg);
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const num = (n: number, d = 2) => n.toLocaleString("es-MX", { maximumFractionDigits: d });

export interface EncabezadoFicha {
  empresa: string;
  empresaCodigo?: string | null;
  logoUrl?: string | null;
  fecha: string;
  elaboro: string | null;
  telefono?: string | null;
  correo?: string | null;
}

/** Dibujo esquemático de la sección (SVG): patín, alma, 3 varillas y celosía. */
export function svgSeccionVigueta(f: FichaVigueta): string {
  const esc1 = 8; // px por cm
  const w = Math.max(f.anchoPatin, f.anchoAlma) * esc1 + 40;
  const h = f.peralte * esc1 + 40;
  const x0 = 20 + ((Math.max(f.anchoPatin, f.anchoAlma) - f.anchoPatin) * esc1) / 2;
  const patinH = Math.min(4, f.peralte / 3) * esc1;
  const almaX = 20 + ((Math.max(f.anchoPatin, f.anchoAlma) - f.anchoAlma) * esc1) / 2;
  const yTop = 20, yBot = 20 + f.peralte * esc1;
  const varillasInf = Array.from({ length: f.varillasInferiores }, (_, i) => {
    const cx = x0 + ((i + 1) * f.anchoPatin * esc1) / (f.varillasInferiores + 1);
    return `<circle cx="${cx}" cy="${yBot - patinH / 2}" r="4" fill="#334155"/>`;
  }).join("");
  const varillasSup = Array.from({ length: f.varillasSuperiores }, (_, i) => {
    const cx = almaX + ((i + 1) * f.anchoAlma * esc1) / (f.varillasSuperiores + 1);
    return `<circle cx="${cx}" cy="${yTop + 10}" r="4" fill="#334155"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Sección de la vigueta">
  <rect x="${x0}" y="${yBot - patinH}" width="${f.anchoPatin * esc1}" height="${patinH}" fill="#e2e8f0" stroke="#475569"/>
  <rect x="${almaX}" y="${yTop}" width="${f.anchoAlma * esc1}" height="${yBot - patinH - yTop + 1}" fill="#e2e8f0" stroke="#475569"/>
  <path d="M ${almaX + (f.anchoAlma * esc1) / 2} ${yTop + 12} L ${x0 + (f.anchoPatin * esc1) / (f.varillasInferiores + 1)} ${yBot - patinH / 2} L ${almaX + (f.anchoAlma * esc1) / 2} ${yTop + 12} L ${x0 + (f.anchoPatin * esc1 * f.varillasInferiores) / (f.varillasInferiores + 1)} ${yBot - patinH / 2}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="3 2"/>
  ${varillasInf}${varillasSup}
  <text x="${x0 + (f.anchoPatin * esc1) / 2}" y="${h - 4}" font-size="10" text-anchor="middle" fill="#475569">${esc(num(f.anchoPatin, 1))} cm</text>
  <text x="${w - 4}" y="${(yTop + yBot) / 2}" font-size="10" text-anchor="end" fill="#475569" transform="rotate(-90 ${w - 4} ${(yTop + yBot) / 2})">${esc(num(f.peralte, 1))} cm</text>
</svg>`;
}

/** Ficha técnica en carta (una hoja por versión), para imprimir sola o anexar a la cotización. */
export function htmlFichaVigueta(f: FichaVigueta | FichaVigueta[], enc: EncabezadoFicha): string {
  const fichas = Array.isArray(f) ? f : [f];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha técnica · ${esc(fichas.map((x) => x.nombre).join(" · "))}</title>
<style>${estilosFicha()}</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
${fichas.map((x) => cuerpoFicha(x, enc)).join("\n")}
</body></html>`;
}

/** "Hasta 3 m" o "De 3 a 3.5 m", según la versión. */
export function textoClaro(f: FichaVigueta): string {
  return f.claroDesde > 0 ? `De ${num(f.claroDesde, 2)} a ${num(f.claroMaximo, 2)} m` : `Hasta ${num(f.claroMaximo, 2)} m`;
}

export function estilosFicha(): string {
  return `
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .ficha { max-width: 190mm; margin: 0 auto; padding: 12px; break-before: page; }
  .ficha:first-child { break-before: auto; }
  .ficha .version { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 10px; background: #dbeafe; color: #1e3a8a; font-size: 11px; font-weight: 600; }
  .ficha .cab { display: flex; justify-content: space-between; align-items: center; gap: 16px; border-bottom: 3px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
  .ficha .cab img { height: 52px; max-width: 170px; object-fit: contain; }
  .ficha .emp { font-size: 18px; font-weight: 800; color: #1d4ed8; }
  .ficha .tit { text-align: right; } .ficha .tit .t { font-size: 11px; letter-spacing: 1px; color: #1d4ed8; font-weight: bold; } .ficha .tit .n { font-size: 20px; font-weight: bold; }
  .ficha .dos { display: grid; grid-template-columns: 1fr 180px; gap: 14px; align-items: start; }
  .ficha h2 { font-size: 12px; text-transform: uppercase; margin: 12px 0 4px; color: #1d4ed8; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }
  .ficha table { width: 100%; border-collapse: collapse; }
  .ficha th, .ficha td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; text-align: left; }
  .ficha th { width: 38%; background: #f1f5f9; font-weight: 600; }
  .ficha .chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
  .ficha .chip { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; } .ficha .chip .v { font-size: 16px; font-weight: bold; } .ficha .chip .k { font-size: 10px; color: #555; }
  .ficha .seccion { text-align: center; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; } .ficha .seccion .l { font-size: 10px; color: #555; }
  .ficha p { margin: 4px 0; }
  .ficha .pie { margin-top: 12px; font-size: 10px; color: #666; border-top: 1px solid #cbd5e1; padding-top: 6px; }
  .ficha .ojo { color: #9a6b00; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .ficha { padding: 0; } }`;
}

/** Solo el cuerpo (para anexarlo a la cotización, que ya trae html y estilos). */
export function cuerpoFicha(f: FichaVigueta, enc: EncabezadoFicha): string {
  const a = aceroVigueta(f);
  const peso = pesoVigueta(f);
  return `<div class="ficha">
  <div class="cab">
    <div style="display:flex;align-items:center;gap:12px">
      ${enc.logoUrl ? `<img src="${esc(enc.logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <div><div class="emp">${esc(enc.empresa)}</div>${enc.telefono ? `<div style="font-size:11px;color:#555">Tel. ${esc(enc.telefono)}</div>` : ""}${enc.correo ? `<div style="font-size:11px;color:#555">${esc(enc.correo)}</div>` : ""}</div>
    </div>
    <div class="tit"><div class="t">FICHA TÉCNICA</div><div class="n">${esc(f.nombre)}</div><div class="version">Versión ${esc(f.version)} · varilla ${esc(f.calibreInferior)} · claros ${esc(textoClaro(f).toLowerCase())}</div><div style="font-size:11px;color:#555">${esc(enc.fecha)}</div></div>
  </div>
  <div class="chips">
    <div class="chip"><div class="v">${esc(num(f.peralte, 0))} cm</div><div class="k">Peralte</div></div>
    <div class="chip"><div class="v">${esc(a.varillas)} varillas</div><div class="k">${esc(f.calibreInferior === f.calibreSuperior ? `todas de ${f.calibreInferior}` : `${f.calibreInferior} inf. / ${f.calibreSuperior} sup.`)}</div></div>
    <div class="chip"><div class="v">${esc(num(peso.totalKgM, 1))} kg/m</div><div class="k">Peso aproximado</div></div>
    <div class="chip"><div class="v">hasta ${esc(num(f.largoMaximo, 2))} m</div><div class="k">Largo de fabricación</div></div>
  </div>
  <div class="dos">
    <div>
      <h2>Geometría</h2>
      <table>
        <tr><th>Peralte</th><td>${esc(num(f.peralte, 1))} cm</td></tr>
        <tr><th>Ancho del patín inferior / alma</th><td>${esc(num(f.anchoPatin, 1))} cm / ${esc(num(f.anchoAlma, 1))} cm</td></tr>
        <tr><th>Sección de concreto</th><td>${esc(num(f.seccionCm2, 0))} cm²</td></tr>
        <tr><th>Largos</th><td>Hasta ${esc(num(f.largoMaximo, 2))} m, cortes a medida en múltiplos de ${esc(num(f.multiploCorte, 0))} cm</td></tr>
        <tr><th>Peso</th><td>${esc(num(peso.totalKgM, 1))} kg/m (concreto ${esc(num(peso.concretoKgM, 1))} + acero ${esc(num(peso.aceroKgM, 2))})</td></tr>
      </table>
      <h2>Materiales</h2>
      <table>
        <tr><th>Concreto</th><td>f'c = ${esc(num(f.fcConcreto, 0))} kg/cm². ${esc(f.concretoTexto)}</td></tr>
        <tr><th>Armadura</th><td>${esc(a.descripcion)}. Varilla ${esc(f.gradoVarilla)}.</td></tr>
        <tr><th>Acero por metro</th><td>${esc(num(a.totalKgM, 2))} kg/m (varillas ${esc(num(a.varillasKgM, 2))} + celosía ${esc(num(a.celosiaKgM, 2))})</td></tr>
      </table>
    </div>
    <div class="seccion">${svgSeccionVigueta(f)}<div class="l">Sección esquemática: ${esc(f.varillasInferiores)} varilla${f.varillasInferiores === 1 ? "" : "s"} en el patín, ${esc(f.varillasSuperiores)} superior y celosía</div></div>
  </div>
  <h2>Sistema de losa</h2>
  <table>
    <tr><th>Separación entre ejes</th><td>${esc(num(f.separacionEjes, 2))} m con ${esc(f.bovedilla)}</td></tr>
    <tr><th>Capa de compresión</th><td>${esc(num(f.capaCompresion, 0))} cm de concreto con ${esc(f.mallaCapa)}</td></tr>
    <tr><th>Claro recomendado</th><td>${esc(textoClaro(f))}${f.cargaServicio > 0 ? ` para una carga de servicio de ${esc(num(f.cargaServicio, 0))} kg/m²` : ` <span class="ojo">(carga de servicio por confirmar con cálculo estructural)</span>`}</td></tr>
    <tr><th>Apoyo mínimo</th><td>${esc(num(f.apoyoMinimo, 0))} cm en cada extremo</td></tr>
    <tr><th>Apuntalamiento</th><td>${esc(f.apuntalamiento)}</td></tr>
  </table>
  <h2>Uso, manejo y normas</h2>
  <p><strong>Usos:</strong> ${esc(f.usos)}</p>
  <p><strong>Manejo y estiba:</strong> ${esc(f.manejo)}</p>
  <p><strong>Normas de referencia:</strong> ${esc(f.normas)}</p>
  ${f.notas ? `<p><strong>Notas:</strong> ${esc(f.notas)}</p>` : ""}
  <div class="pie">Los claros y cargas son orientativos para el sistema descrito; el diseño de cada losa se confirma con cálculo estructural. ${f.version === "sencilla" ? "Para claros mayores se usa la versión reforzada (varilla 1/2\")." : "Para claros cortos (hasta 3 m) se usa la versión sencilla (varilla 3/8\")."} Elaboró: ${esc(enc.elaboro ?? "—")}.</div>
</div>`;
}
