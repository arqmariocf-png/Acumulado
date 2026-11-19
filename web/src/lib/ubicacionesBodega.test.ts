import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparUbicaciones, codigoUbicacion, generarUbicaciones, lugaresParaContar, nombreUbicacion, revisarRack, urlEtiquetaLugar, type Ubicacion } from "./ubicacionesBodega.ts";

test("codigoUbicacion: bodega a 3 letras, rack con 2 dígitos, nivel y posición", () => {
  assert.equal(codigoUbicacion("Bodega 1", "3", 2, 4), "BOD-R03-N2-P4");
  assert.equal(codigoUbicacion("Almacén general", "A", 1, null), "ALM-RA-N1");
  assert.equal(codigoUbicacion("", "12", null, null), "BOD-R12");
  assert.equal(codigoUbicacion("Patio", "Ñ-1", null, null), "PAT-RN1");
});

test("revisarRack y generarUbicaciones", () => {
  assert.equal(revisarRack({ bodega: "B", rack: "", niveles: 3, posiciones: 0 })?.includes("rack"), true);
  assert.match(revisarRack({ bodega: "B", rack: "1", niveles: 0, posiciones: 2 }) ?? "", /nivel/);
  assert.match(revisarRack({ bodega: "B", rack: "1", niveles: 50, posiciones: 50 }) ?? "", /demasiados/);
  assert.equal(revisarRack({ bodega: "B", rack: "1", niveles: 3, posiciones: 0 }), null);
  const filas = generarUbicaciones("Bodega", "3", 2, 2);
  assert.deepEqual(
    filas.map((f) => f.codigo),
    ["BOD-R03", "BOD-R03-N1", "BOD-R03-N1-P1", "BOD-R03-N1-P2", "BOD-R03-N2", "BOD-R03-N2-P1", "BOD-R03-N2-P2"],
  );
  assert.equal(generarUbicaciones("Bodega", "7", 0, 0).length, 1, "rack sin niveles = un solo lugar");
});

const base = (x: Partial<Ubicacion>): Ubicacion => ({ id: x.codigo ?? "", empresa_id: "e", bodega: "Bodega", rack: "1", nivel: null, posicion: null, codigo: "", descripcion: null, activo: true, ...x });

test("agruparUbicaciones, nombreUbicacion y lugaresParaContar", () => {
  const lista = [
    base({ codigo: "BOD-R10", rack: "10" }),
    base({ codigo: "BOD-R02-N1", rack: "2", nivel: 1 }),
    base({ codigo: "BOD-R02", rack: "2" }),
    base({ codigo: "BOD-R02-N1-P1", rack: "2", nivel: 1, posicion: 1 }),
    base({ codigo: "BOD-R02-N2", rack: "2", nivel: 2 }),
    base({ codigo: "BOD-R10-N1", rack: "10", nivel: 1, activo: false }),
  ];
  const g = agruparUbicaciones(lista);
  assert.deepEqual(g.map((r) => r.rack), ["2", "10"], "orden natural: 2 antes que 10");
  assert.equal(g[0].cabecera?.codigo, "BOD-R02");
  assert.deepEqual(g[0].niveles.map((n) => [n.nivel, n.lugar?.codigo, n.posiciones.length]), [[1, "BOD-R02-N1", 1], [2, "BOD-R02-N2", 0]]);
  assert.equal(nombreUbicacion(lista[3]), "Bodega · Rack 2 · Nivel 1 · Pos. 1");
  assert.deepEqual(
    lugaresParaContar(lista).map((u) => u.codigo),
    ["BOD-R10", "BOD-R02-N1-P1", "BOD-R02-N2"],
    "rack 10 cuenta en el rack (su nivel está inactivo); nivel 1 cuenta en su posición; nivel 2 en el nivel",
  );
  assert.equal(urlEtiquetaLugar("BOD-R02-N1"), "/inventario/conteo?lugar=BOD-R02-N1");
});
