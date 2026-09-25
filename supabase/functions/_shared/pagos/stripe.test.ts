// Pruebas del adaptador de Stripe. Las dos cosas que se prueban aquí son las
// que, si fallan, cuestan dinero o abren un hoyo: la verificación de firma
// del webhook (endpoint público) y la traducción de eventos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clienteDelEvento, firmar, grupoDelEvento, parsearHeaderFirma, traducirEvento, verificarFirma } from "./stripe.ts";

const SECRETO = "whsec_prueba";
const CUERPO = '{"id":"evt_1","type":"invoice.payment_succeeded"}';

async function headerValido(timestamp: number, cuerpo = CUERPO, secreto = SECRETO): Promise<string> {
  return `t=${timestamp},v1=${await firmar(`${timestamp}.${cuerpo}`, secreto)}`;
}

test("acepta una firma válida dentro de la tolerancia", async () => {
  const t = 1_800_000_000;
  assert.equal(await verificarFirma(CUERPO, await headerValido(t), SECRETO, t), true);
});

test("rechaza una firma hecha con otro secreto", async () => {
  const t = 1_800_000_000;
  const header = await headerValido(t, CUERPO, "whsec_otro");
  assert.equal(await verificarFirma(CUERPO, header, SECRETO, t), false);
});

test("rechaza si el cuerpo cambió aunque sea un carácter", async () => {
  const t = 1_800_000_000;
  const header = await headerValido(t);
  assert.equal(await verificarFirma(CUERPO + " ", header, SECRETO, t), false);
});

test("rechaza un evento viejo: reenviar una petición capturada no sirve", async () => {
  const t = 1_800_000_000;
  const header = await headerValido(t);
  assert.equal(await verificarFirma(CUERPO, header, SECRETO, t + 301), false);
  assert.equal(await verificarFirma(CUERPO, header, SECRETO, t + 299), true);
});

test("rechaza header ausente, vacío o sin firma v1", async () => {
  const t = 1_800_000_000;
  assert.equal(await verificarFirma(CUERPO, null, SECRETO, t), false);
  assert.equal(await verificarFirma(CUERPO, "", SECRETO, t), false);
  assert.equal(await verificarFirma(CUERPO, `t=${t}`, SECRETO, t), false);
});

test("rechaza si no hay secreto configurado (no se acepta todo por omisión)", async () => {
  const t = 1_800_000_000;
  assert.equal(await verificarFirma(CUERPO, await headerValido(t), "", t), false);
});

test("el header puede traer varias firmas v1 y basta con que una cuadre", async () => {
  const t = 1_800_000_000;
  const buena = await firmar(`${t}.${CUERPO}`, SECRETO);
  const header = `t=${t},v1=0000,v1=${buena}`;
  assert.deepEqual(parsearHeaderFirma(header).firmas, ["0000", buena]);
  assert.equal(await verificarFirma(CUERPO, header, SECRETO, t), true);
});

test("traduce un cobro exitoso con su periodo y su monto", () => {
  const evento = traducirEvento({
    type: "invoice.payment_succeeded",
    created: 1_800_000_000,
    data: {
      object: {
        id: "in_123",
        amount_paid: 150000,
        currency: "mxn",
        lines: { data: [{ period: { start: 1_800_000_000, end: 1_802_592_000 } }] },
      },
    },
  });

  assert.equal(evento?.tipo, "cobro_exitoso");
  assert.equal(evento?.montoCentavos, 150000);
  assert.equal(evento?.moneda, "MXN");
  assert.equal(evento?.pagoId, "in_123");
  assert.equal(evento?.periodoFin, new Date(1_802_592_000 * 1000).toISOString());
});

test("traduce un cobro fallido con el motivo que da Stripe", () => {
  const evento = traducirEvento({
    type: "invoice.payment_failed",
    created: 1_800_000_000,
    data: { object: { id: "in_falla", amount_due: 150000, currency: "mxn", last_finalization_error: { message: "tarjeta declinada" } } },
  });

  assert.equal(evento?.tipo, "cobro_fallido");
  assert.equal(evento?.detalleError, "tarjeta declinada");
});

test("una suscripción que pasa a cancelada por update también cancela", () => {
  assert.equal(
    traducirEvento({ type: "customer.subscription.updated", created: 1, data: { object: { status: "canceled" } } })?.tipo,
    "suscripcion_cancelada",
  );
  assert.equal(
    traducirEvento({ type: "customer.subscription.deleted", created: 1, data: { object: {} } })?.tipo,
    "suscripcion_cancelada",
  );
});

test("un update a un estado que no nos importa (past_due, incomplete) se ignora", () => {
  for (const status of ["past_due", "incomplete", "unpaid"]) {
    assert.equal(traducirEvento({ type: "customer.subscription.updated", created: 1, data: { object: { status } } }), null);
  }
});

test("toma marca y últimos 4 de la tarjeta, nunca el número", () => {
  const evento = traducirEvento({
    type: "payment_method.attached",
    created: 1,
    data: { object: { card: { brand: "visa", last4: "4242" } } },
  });

  assert.deepEqual(evento?.metodoPago, { marca: "visa", ultimos4: "4242" });
});

test("los eventos que no nos interesan se ignoran sin reventar", () => {
  assert.equal(traducirEvento({ type: "charge.refunded", created: 1, data: { object: {} } }), null);
  assert.equal(traducirEvento({}), null);
});

test("el cliente y la organización se sacan del evento, con null si no vienen", () => {
  const evento = {
    type: "invoice.payment_succeeded",
    data: { object: { customer: "cus_1", subscription_details: { metadata: { grupo_id: "g-1" } } } },
  };

  assert.equal(clienteDelEvento(evento), "cus_1");
  assert.equal(grupoDelEvento(evento), "g-1");
  assert.equal(clienteDelEvento({ data: { object: {} } }), null);
  assert.equal(grupoDelEvento({ data: { object: {} } }), null);
  assert.equal(clienteDelEvento({}), null);
});
