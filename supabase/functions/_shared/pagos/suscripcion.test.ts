// Pruebas de las reglas de suscripción. El caso que más importa es el de los
// reintentos: una pasarela manda un evento de cobro fallido por CADA intento
// (Stripe reintenta hasta 4 veces en ~2 semanas), y si cada uno reiniciara la
// gracia, quien nunca paga nunca se suspende.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarEvento, estadoEfectivo, puedeEscribir } from "./suscripcion.ts";
import type { SuscripcionActual } from "./tipos.ts";

function activa(extra: Partial<SuscripcionActual> = {}): SuscripcionActual {
  return { estado: "activa", diasGracia: 7, periodoFin: "2026-10-01T00:00:00.000Z", graciaHasta: null, ...extra };
}

test("un cobro exitoso deja la suscripción activa y mueve el fin de periodo", () => {
  const cambio = aplicarEvento(activa({ estado: "periodo_gracia", graciaHasta: "2026-09-20T00:00:00.000Z" }), {
    tipo: "cobro_exitoso",
    ocurridoEn: "2026-09-18T10:00:00.000Z",
    periodoInicio: "2026-09-18T00:00:00.000Z",
    periodoFin: "2026-10-18T00:00:00.000Z",
    montoCentavos: 150000,
    moneda: "MXN",
    pagoId: "pi_123",
  });

  assert.equal(cambio.estado, "activa");
  assert.equal(cambio.periodoFin, "2026-10-18T00:00:00.000Z");
  assert.equal(cambio.graciaHasta, null, "un cobro exitoso limpia la gracia");
  assert.equal(cambio.pago?.estado, "pagado");
  assert.equal(cambio.pago?.montoCentavos, 150000);
  assert.equal(cambio.pago?.pagadoEn, "2026-09-18T10:00:00.000Z");
});

test("un cobro fallido abre el periodo de gracia por los días configurados", () => {
  const cambio = aplicarEvento(activa(), {
    tipo: "cobro_fallido",
    ocurridoEn: "2026-10-01T12:00:00.000Z",
    montoCentavos: 150000,
    moneda: "MXN",
    pagoId: "pi_falla",
    detalleError: "tarjeta declinada",
  });

  assert.equal(cambio.estado, "periodo_gracia");
  assert.equal(cambio.graciaHasta, "2026-10-08T12:00:00.000Z");
  assert.equal(cambio.pago?.estado, "fallido");
  assert.equal(cambio.pago?.detalleError, "tarjeta declinada");
});

test("los reintentos NO reinician la gracia: se cuenta desde el primer fallo", () => {
  const primerFallo = aplicarEvento(activa(), {
    tipo: "cobro_fallido",
    ocurridoEn: "2026-10-01T12:00:00.000Z",
  });

  const segundoFallo = aplicarEvento(
    { estado: primerFallo.estado, diasGracia: 7, periodoFin: null, graciaHasta: primerFallo.graciaHasta },
    { tipo: "cobro_fallido", ocurridoEn: "2026-10-05T12:00:00.000Z" },
  );

  assert.equal(segundoFallo.graciaHasta, primerFallo.graciaHasta);
});

test("cancelar deja la suscripción cancelada, sin gracia", () => {
  const cambio = aplicarEvento(activa({ estado: "periodo_gracia", graciaHasta: "2026-10-08T00:00:00.000Z" }), {
    tipo: "suscripcion_cancelada",
    ocurridoEn: "2026-10-02T00:00:00.000Z",
  });

  assert.equal(cambio.estado, "cancelada");
  assert.equal(cambio.graciaHasta, null);
});

test("actualizar el método de pago no cambia el estado ni registra un pago", () => {
  const cambio = aplicarEvento(activa(), {
    tipo: "metodo_pago_actualizado",
    ocurridoEn: "2026-09-25T00:00:00.000Z",
    metodoPago: { marca: "visa", ultimos4: "4242" },
  });

  assert.equal(cambio.estado, "activa");
  assert.equal(cambio.pago, null);
  assert.deepEqual(cambio.metodoPago, { marca: "visa", ultimos4: "4242" });
});

test("una gracia vencida ya es suspensión aunque nadie haya corrido el barrido", () => {
  const enGracia: SuscripcionActual = {
    estado: "periodo_gracia",
    diasGracia: 7,
    periodoFin: null,
    graciaHasta: "2026-10-08T00:00:00.000Z",
  };

  assert.equal(estadoEfectivo(enGracia, new Date("2026-10-07T00:00:00.000Z")), "periodo_gracia");
  assert.equal(puedeEscribir(enGracia, new Date("2026-10-07T00:00:00.000Z")), true);
  assert.equal(estadoEfectivo(enGracia, new Date("2026-10-09T00:00:00.000Z")), "suspendida");
  assert.equal(puedeEscribir(enGracia, new Date("2026-10-09T00:00:00.000Z")), false);
});

test("una 'activa' con el periodo vencido hace rato deja de escribir (webhook perdido)", () => {
  const sinNoticias = activa({ periodoFin: "2026-10-01T00:00:00.000Z" });

  assert.equal(puedeEscribir(sinNoticias, new Date("2026-10-07T00:00:00.000Z")), true, "dentro de los 7 días de red");
  assert.equal(puedeEscribir(sinNoticias, new Date("2026-10-09T00:00:00.000Z")), false);
});

test("la prueba escribe hasta su fecha límite y ni un día más", () => {
  const prueba: SuscripcionActual = {
    estado: "prueba",
    diasGracia: 7,
    periodoFin: "2026-10-23T00:00:00.000Z",
    graciaHasta: null,
  };

  assert.equal(puedeEscribir(prueba, new Date("2026-10-22T00:00:00.000Z")), true);
  assert.equal(puedeEscribir(prueba, new Date("2026-10-24T00:00:00.000Z")), false);
  assert.equal(estadoEfectivo(prueba, new Date("2026-10-24T00:00:00.000Z")), "suspendida");
});

test("suspendida y cancelada no escriben, con o sin fechas", () => {
  for (const estado of ["suspendida", "cancelada"] as const) {
    assert.equal(puedeEscribir({ estado, diasGracia: 7, periodoFin: null, graciaHasta: null }), false);
  }
});
