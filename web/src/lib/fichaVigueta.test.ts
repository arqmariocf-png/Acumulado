import { test } from "node:test";
import assert from "node:assert/strict";
import { FICHA_BASE, FICHA_REFORZADA, FICHA_SENCILLA, aceroVigueta, costoAceroPorMetro, cuerpoFicha, htmlFichaVigueta, pesoVigueta, textoClaro, versionPorClaro } from "./fichaVigueta.ts";

test("dos versiones: sencilla 3/8 hasta 3 m y reforzada 1/2 para claros mayores, concreto f'c 200", () => {
  assert.equal(FICHA_BASE, FICHA_SENCILLA);
  assert.equal(FICHA_SENCILLA.fcConcreto, 200);
  assert.equal(FICHA_REFORZADA.fcConcreto, 200);
  assert.equal(FICHA_SENCILLA.calibreInferior, '3/8"');
  assert.equal(FICHA_REFORZADA.calibreInferior, '1/2"');
  assert.equal(textoClaro(FICHA_SENCILLA), "Hasta 3 m");
  assert.equal(textoClaro(FICHA_REFORZADA), "De 3 a 3.5 m");
  assert.equal(versionPorClaro(2.8), "sencilla");
  assert.equal(versionPorClaro(3), "sencilla");
  assert.equal(versionPorClaro(3.2), "reforzada");
  // La reforzada: 3 varillas de 1/2 = 2.98 kg/m + celosía 0.35
  const r = aceroVigueta(FICHA_REFORZADA);
  assert.equal(r.varillasKgM, 2.98);
  assert.equal(r.totalKgM, 3.33);
  assert.match(r.descripcion, /2 × 1\/2" inferiores \+ 1 × 1\/2" superior/);
});

test("acero de la vigueta sencilla: 3 varillas de 3/8 más celosía de 1/4", () => {
  const a = aceroVigueta(FICHA_BASE);
  assert.equal(a.varillas, 3);
  assert.equal(a.varillasKgM, 1.67);
  assert.equal(a.celosiaKgM, 0.35);
  assert.equal(a.totalKgM, 2.02);
  assert.match(a.descripcion, /3 varillas \(2 × 3\/8" inferiores \+ 1 × 3\/8" superior\) con celosía de alambrón 1\/4"/);
  // Sin varilla superior y con celosía doble
  const b = aceroVigueta({ ...FICHA_BASE, varillasSuperiores: 0, celosiaMetrosPorMetro: 2.8 });
  assert.equal(b.varillas, 2);
  assert.equal(b.totalKgM, 1.81);
});

test("peso y costo del acero por metro", () => {
  const p = pesoVigueta(FICHA_BASE);
  assert.equal(p.concretoKgM, 24);
  assert.equal(p.totalKgM, 26.02);
  // varilla 3/8 a $18.26/kg (AEP, $122 la pieza de 12 m) y alambrón 1/4 a $20/kg
  assert.equal(costoAceroPorMetro(FICHA_BASE, 18.26, 20), 37.49);
});

test("ficha técnica imprimible con los datos y el aviso de carga por confirmar", () => {
  const html = htmlFichaVigueta(FICHA_BASE, { empresa: "Balken <VBB>", fecha: "5/11/2026", elaboro: "Jaime", logoUrl: "/logos/VBB.png" });
  assert.match(html, /Balken &lt;VBB&gt;/);
  assert.match(html, /3 varillas/);
  assert.match(html, /2\.02 kg\/m/);
  assert.match(html, /26 kg\/m/);
  assert.match(html, /carga de servicio por confirmar/);
  assert.match(html, /<svg/);
  assert.match(html, /Versión sencilla · varilla 3\/8" · claros hasta 3 m/);
  assert.match(html, /f'c = 200 kg\/cm²/);
  // Las dos fichas en un documento: una hoja por versión
  const dos = htmlFichaVigueta([FICHA_SENCILLA, FICHA_REFORZADA], { empresa: "Balken", fecha: "5/11/2026", elaboro: null });
  assert.equal((dos.match(/<div class="ficha">/g) ?? []).length, 2);
  assert.match(dos, /Versión reforzada · varilla 1\/2" · claros de 3 a 3.5 m/);
  const conCarga = cuerpoFicha({ ...FICHA_BASE, cargaServicio: 350 }, { empresa: "Balken", fecha: "5/11/2026", elaboro: null });
  assert.match(conCarga, /carga de servicio de 350 kg\/m²/);
  assert.doesNotMatch(conCarga, /por confirmar/);
});
