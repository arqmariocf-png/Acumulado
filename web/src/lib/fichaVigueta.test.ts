import { test } from "node:test";
import assert from "node:assert/strict";
import { FICHA_BASE, aceroVigueta, costoAceroPorMetro, cuerpoFicha, htmlFichaVigueta, pesoVigueta } from "./fichaVigueta.ts";

test("acero de la vigueta: 3 varillas de 3/8 más celosía de 1/4", () => {
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
  const conCarga = cuerpoFicha({ ...FICHA_BASE, cargaServicio: 350 }, { empresa: "Balken", fecha: "5/11/2026", elaboro: null });
  assert.match(conCarga, /carga de servicio de 350 kg\/m²/);
  assert.doesNotMatch(conCarga, /por confirmar/);
});
