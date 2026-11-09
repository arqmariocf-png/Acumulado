import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizar, puedeCrearObra, puedeCrearTablero, revisarObra } from "./altaObra.ts";

test("quién da de alta obras", () => {
  assert.equal(puedeCrearObra({ rol: "admin" }), true);
  assert.equal(puedeCrearObra({ rol: "direccion" }), true);
  assert.equal(puedeCrearObra({ rol: "responsable" }), true);
  // Timoteo: administrativo con módulo proyectos.
  assert.equal(puedeCrearObra({ rol: "administrativo", empresa_id: "csc", modulos: ["proyectos", "requisiciones"] }), true);
  assert.equal(puedeCrearObra({ rol: "administrativo", empresa_id: "csc", modulos: ["requisiciones"] }), false);
  assert.equal(puedeCrearObra({ rol: "almacen" }), false);
  assert.equal(puedeCrearObra({ rol: "pendiente" }), false);
  assert.equal(puedeCrearObra(null), false);
});

test("quién crea tableros y en qué empresas", () => {
  assert.deepEqual(puedeCrearTablero({ rol: "corporativo" }, []), { puede: true, soloEnAlcance: false });
  // Timoteo: CSC + MCF (maneja también).
  assert.deepEqual(puedeCrearTablero({ rol: "administrativo", empresa_id: "csc", modulos: ["proyectos"] }, ["csc", "mcf"]), { puede: true, soloEnAlcance: true });
  assert.deepEqual(puedeCrearTablero({ rol: "administrativo", empresa_id: "csc", modulos: ["proyectos"] }, []), { puede: false, soloEnAlcance: true });
  assert.deepEqual(puedeCrearTablero({ rol: "operativo", empresa_id: "csc", modulos: ["tareas"] }, ["csc"]), { puede: false, soloEnAlcance: true });
});

test("revisar la obra nueva: nombre, empresa y repetidas", () => {
  const existentes = [
    { nombre: "Abarrotes Neto Rio Frio", empresa_id: "csc", activo: true },
    { nombre: "Parque Real 42", empresa_id: "mcf", activo: false },
  ];
  assert.equal(revisarObra({ nombre: "Ab", empresa_id: "csc" }, existentes), "Escribe el nombre de la obra (mínimo 3 letras).");
  assert.equal(revisarObra({ nombre: "Obra nueva", empresa_id: "" }, existentes), "Elige la empresa de la obra.");
  assert.equal(revisarObra({ nombre: "abarrotes neto río frío", empresa_id: "csc" }, existentes), 'Ya existe la obra "Abarrotes Neto Rio Frio" en esa empresa.');
  assert.equal(revisarObra({ nombre: "Abarrotes Neto Rio Frio", empresa_id: "mcf" }, existentes), null);
  assert.match(revisarObra({ nombre: "PARQUE REAL 42", empresa_id: "mcf" }, existentes) ?? "", /desactivada: reactívala/);
  assert.equal(revisarObra({ nombre: "Abarrotes Neto Apizaco", empresa_id: "csc" }, existentes), null);
  assert.equal(normalizar("  Río  Frío, Nº 3 "), "rio frio n 3");
});
