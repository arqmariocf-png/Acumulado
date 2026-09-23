import test from "node:test";
import assert from "node:assert/strict";
import { agendaTotals, groupByDate, isOverdue, sortAgenda, sumAmounts, type AgendaEntry } from "./agendaPagosExterna.ts";

const HOY = "2026-08-27";

function entry(over: Partial<AgendaEntry> & { id: string }): AgendaEntry {
  return {
    origin: "mano_obra",
    concept: "Ana",
    detail: "24–30 ago",
    scheduledFor: "2026-08-31",
    method: "transferencia",
    status: "programado",
    amountCents: 100000,
    paidAt: null,
    reference: null,
    ...over,
  };
}

// ============================================================
// Orden
// ============================================================

test("ordena por fecha de pago: primero lo que se paga antes", () => {
  const ordered = sortAgenda([
    entry({ id: "c", scheduledFor: "2026-09-07" }),
    entry({ id: "a", scheduledFor: "2026-08-31" }),
    entry({ id: "b", scheduledFor: "2026-09-01" }),
  ]);
  assert.deepEqual(ordered.map((e) => e.id), ["a", "b", "c"]);
});

test("lo que no tiene fecha se va al final, no al principio", () => {
  const ordered = sortAgenda([
    entry({ id: "sin-fecha", scheduledFor: null }),
    entry({ id: "con-fecha", scheduledFor: "2026-09-07" }),
  ]);
  assert.deepEqual(ordered.map((e) => e.id), ["con-fecha", "sin-fecha"]);
});

test("a misma fecha, el orden es estable por origen y nombre", () => {
  const ordered = sortAgenda([
    entry({ id: "2", origin: "nomina_semanal", concept: "Zoe" }),
    entry({ id: "1", origin: "mano_obra", concept: "Beto" }),
    entry({ id: "3", origin: "nomina_semanal", concept: "Ana" }),
  ]);
  assert.deepEqual(ordered.map((e) => e.id), ["1", "3", "2"]);
});

test("sortAgenda no muta el arreglo que recibe", () => {
  const original = [entry({ id: "b", scheduledFor: "2026-09-07" }), entry({ id: "a", scheduledFor: "2026-08-31" })];
  sortAgenda(original);
  assert.deepEqual(original.map((e) => e.id), ["b", "a"]);
});

// ============================================================
// Vencidos
// ============================================================

test("programado con fecha pasada está vencido", () => {
  assert.equal(isOverdue(entry({ id: "x", scheduledFor: "2026-08-26" }), HOY), true);
});

test("lo de hoy todavía no está vencido", () => {
  assert.equal(isOverdue(entry({ id: "x", scheduledFor: HOY }), HOY), false);
});

test("lo ya pagado nunca está vencido, aunque su fecha haya pasado", () => {
  const pagado = entry({ id: "x", scheduledFor: "2026-08-01", status: "pagado", paidAt: "2026-08-02T10:00:00Z" });
  assert.equal(isOverdue(pagado, HOY), false);
});

test("sin fecha programada no cuenta como vencido", () => {
  assert.equal(isOverdue(entry({ id: "x", scheduledFor: null }), HOY), false);
});

// ============================================================
// Agrupado por día
// ============================================================

test("agrupa por día de pago y suma cada grupo", () => {
  const groups = groupByDate(
    [
      entry({ id: "1", scheduledFor: "2026-08-31", amountCents: 100000 }),
      entry({ id: "2", scheduledFor: "2026-08-31", amountCents: 50000, origin: "nomina_semanal" }),
      entry({ id: "3", scheduledFor: "2026-09-07", amountCents: 25000 }),
    ],
    HOY,
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-08-31");
  assert.equal(groups[0].totalCents, 150000, "el día junta los dos orígenes en un solo total");
  assert.equal(groups[1].date, "2026-09-07");
  assert.equal(groups[1].totalCents, 25000);
});

test("el grupo sin fecha queda al final y con date en null", () => {
  const groups = groupByDate(
    [entry({ id: "1", scheduledFor: null }), entry({ id: "2", scheduledFor: "2026-08-31" })],
    HOY,
  );
  assert.equal(groups[0].date, "2026-08-31");
  assert.equal(groups[1].date, null);
});

test("un grupo se marca vencido si alguna de sus entradas lo está", () => {
  const groups = groupByDate(
    [
      entry({ id: "1", scheduledFor: "2026-08-20", status: "pagado", paidAt: "2026-08-20T10:00:00Z" }),
      entry({ id: "2", scheduledFor: "2026-08-20" }),
    ],
    HOY,
  );
  assert.equal(groups[0].overdue, true);
});

test("agrupar una agenda vacía da una lista vacía, no un grupo fantasma", () => {
  assert.deepEqual(groupByDate([], HOY), []);
});

// ============================================================
// Totales
// ============================================================

test("los totales separan programado, pagado y vencido", () => {
  const totals = agendaTotals(
    [
      entry({ id: "1", scheduledFor: "2026-08-20", amountCents: 30000 }), // vencido
      entry({ id: "2", scheduledFor: "2026-09-07", amountCents: 50000 }), // programado
      entry({ id: "3", status: "pagado", amountCents: 70000, paidAt: "2026-08-25T10:00:00Z" }),
    ],
    HOY,
  );

  assert.equal(totals.scheduledCents, 80000, "vencido sigue siendo programado: cuenta en ambos");
  assert.equal(totals.overdueCents, 30000);
  assert.equal(totals.paidCents, 70000);
  assert.equal(totals.scheduledCount, 2);
  assert.equal(totals.overdueCount, 1);
  assert.equal(totals.paidCount, 1);
});

test("los totales se abren por origen", () => {
  const totals = agendaTotals(
    [
      entry({ id: "1", origin: "nomina_quincenal", amountCents: 100000 }),
      entry({ id: "2", origin: "mano_obra", amountCents: 250000 }),
      entry({ id: "3", origin: "mano_obra", amountCents: 150000, status: "pagado", paidAt: "2026-08-25T10:00:00Z" }),
    ],
    HOY,
  );

  const mo = totals.byOrigin.find((o) => o.origin === "mano_obra")!;
  assert.equal(mo.scheduledCents, 250000);
  assert.equal(mo.paidCents, 150000);
  assert.equal(mo.count, 2);
  assert.equal(totals.byOrigin.find((o) => o.origin === "nomina_quincenal")!.scheduledCents, 100000);
});

test("un importe ilegible no suma cero silenciosamente: se cuenta aparte", () => {
  const totals = agendaTotals(
    [entry({ id: "1", amountCents: null }), entry({ id: "2", amountCents: 100000 })],
    HOY,
  );
  assert.equal(totals.scheduledCents, 100000);
  assert.equal(totals.unreadableCount, 1);
});

test("sumAmounts ignora los importes ilegibles", () => {
  assert.equal(sumAmounts([entry({ id: "1", amountCents: null }), entry({ id: "2", amountCents: 500 })]), 500);
});

test("los totales de una agenda vacía son cero, no NaN", () => {
  const totals = agendaTotals([], HOY);
  assert.equal(totals.scheduledCents, 0);
  assert.equal(totals.paidCents, 0);
  assert.deepEqual(totals.byOrigin, []);
});
