import { test } from "node:test";
import assert from "node:assert/strict";
import { armarProductos } from "./cotizador.ts";
import { enlaceWhatsapp, esperaRespuesta, interpretarPedido, leerRenglon, mensajeCotizacion, minutosEsperando, partirPedido, telefonoWhatsapp } from "./crmVentas.ts";

const productos = armarProductos({
  planta: [
    { id: "m105", nombre: "Malla ciclónica", calibre: "10.5", unidad_medida: "rollo", costo: 1263.16, existencia: 12 },
    { id: "m12", nombre: "Malla ciclónica", calibre: "12.5", unidad_medida: "rollo", costo: 1100, existencia: 4 },
  ],
  catalogo: [
    { nombre: "Cemento gris 50 kg", unidad_medida: "bulto", costo_referencia: 200, precio_venta: 290, iva_tasa: 0.16 },
    { nombre: "Varilla corrugada 3/8", unidad_medida: "pza", costo_referencia: 95, precio_venta: 160, iva_tasa: 0.16 },
    { nombre: "Alambre recocido", unidad_medida: "kg", costo_referencia: 30, precio_venta: 52, iva_tasa: 0.16 },
  ],
});

test("parte el mensaje en renglones (comas, saltos, 'y' antes de cantidad)", () => {
  assert.deepEqual(partirPedido("Hola, ocupo 10 rollos de malla 10.5 y 5 bultos de cemento\n20 varillas 3/8"), [
    "Hola",
    "ocupo 10 rollos de malla 10.5",
    "5 bultos de cemento",
    "20 varillas 3/8",
  ]);
  assert.deepEqual(partirPedido("tela y alambre"), ["tela y alambre"]);
});

test("lee cantidad, unidad y palabras del producto", () => {
  assert.deepEqual(leerRenglon("ocupo 10 rollos de malla 10.5"), { cantidad: 10, unidad: "rollo", palabras: ["malla", "10.5"] });
  assert.deepEqual(leerRenglon("dos bultos de cemento"), { cantidad: 2, unidad: "bulto", palabras: ["cemento"] });
  assert.deepEqual(leerRenglon("25kg de alambre recocido"), { cantidad: 25, unidad: "kg", palabras: ["alambre", "recocido"] });
  assert.deepEqual(leerRenglon("media docena de varillas"), { cantidad: 6, unidad: null, palabras: ["varilla"] });
  assert.equal(leerRenglon("Hola buenas tardes").palabras.length, 0);
});

test("propone el producto correcto; la medida distingue entre mallas", () => {
  const r = interpretarPedido("Hola buenas tardes, me cotiza 10 rollos de malla ciclonica 10.5, 5 bultos de cemento y 20 varillas de 3/8 por favor", productos);
  assert.deepEqual(
    r.map((x) => [x.producto?.descripcion ?? null, x.cantidad, x.unidad]),
    [
      ["Malla ciclónica 10.5", 10, "rollo"],
      ["Cemento gris 50 kg", 5, "bulto"],
      ["Varilla corrugada 3/8", 20, "pza"],
    ],
  );
  const doce = interpretarPedido("3 rollos malla 12.5", productos)[0];
  assert.equal(doce.producto?.descripcion, "Malla ciclónica 12.5");
  assert.equal(doce.alternativas[0]?.descripcion, "Malla ciclónica 10.5");
});

test("lo que no reconoce queda sin producto, con cantidad, para que el vendedor elija", () => {
  const [r] = interpretarPedido("4 cubetas de pintura vinílica", productos);
  assert.equal(r.producto, null);
  assert.equal(r.cantidad, 4);
  assert.equal(r.unidad, "cubeta");
});

test("WhatsApp: teléfono con 52 y texto de la cotización con IVA", () => {
  assert.equal(telefonoWhatsapp("222 123 4567"), "522221234567");
  assert.equal(telefonoWhatsapp("+52 1 222 123 4567"), "5212221234567");
  assert.equal(telefonoWhatsapp("123"), null);
  const texto = mensajeCotizacion({
    empresa: "Clavicón",
    folio: "COT-MCC-0007",
    cliente: "Juan Pérez",
    vigenciaDias: 15,
    vendedor: "Jaime",
    lineas: [{ descripcion: "Malla ciclónica 10.5", cantidad: 2, unidad: "rollo", precio_unitario: 1500 }],
  });
  assert.match(texto, /^Hola Juan, gracias por escribirnos a Clavicón\./);
  assert.match(texto, /• 2 rollo Malla ciclónica 10\.5: \$1,740\.00 c\/u = \$3,480\.00/);
  assert.match(texto, /Subtotal \$3,000\.00 \+ IVA \$480\.00/);
  assert.match(texto, /\*Total \$3,480\.00\*/);
  assert.ok(enlaceWhatsapp("2221234567", "hola mundo").startsWith("https://wa.me/522221234567?text=hola%20mundo"));
});

test("quién espera respuesta y desde hace cuánto", () => {
  const p = { etapa: "nuevo" as const, ultimo_entrante_en: "2026-10-17T18:00:00Z", ultimo_saliente_en: null };
  assert.equal(esperaRespuesta(p), true);
  assert.equal(minutosEsperando(p, new Date("2026-10-17T19:30:00Z")), 90);
  assert.equal(esperaRespuesta({ ...p, ultimo_saliente_en: "2026-10-17T18:05:00Z" }), false);
  assert.equal(esperaRespuesta({ ...p, etapa: "perdido" }), false);
});
