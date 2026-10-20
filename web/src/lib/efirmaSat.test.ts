import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoEfirma, resumenDescargaSat, revisarArchivos, type SolicitudSat } from "./efirmaSat.ts";

const hoy = new Date("2026-10-07T12:00:00Z");

test("estado de vigencia de la e.firma", () => {
  assert.equal(estadoEfirma(null, hoy), "sin_efirma");
  assert.equal(estadoEfirma("2026-10-01T00:00:00Z", hoy), "vencida");
  assert.equal(estadoEfirma("2026-11-20T00:00:00Z", hoy), "por_vencer");
  assert.equal(estadoEfirma("2028-05-01T00:00:00Z", hoy), "vigente");
});

test("revisión de archivos antes de subir", () => {
  const cer = { name: "aep.cer", size: 1500 };
  const key = { name: "Claveprivada_FIEL_AEL.key", size: 1300 };
  assert.equal(revisarArchivos(cer, key, "x"), null);
  assert.equal(revisarArchivos(null, key, "x"), "Falta el archivo .cer.");
  assert.match(revisarArchivos(key, cer, "x") ?? "", /\.cer/);
  assert.match(revisarArchivos(cer, key, "") ?? "", /contraseña/);
  assert.match(revisarArchivos({ name: "a.cer", size: 900_000 }, key, "x") ?? "", /KB/);
});

test("hasta qué día está al corriente la descarga del SAT", () => {
  const s = (tipo: SolicitudSat["tipo"], estado: string, hasta: string, pedida: string, mensaje: string | null = null): SolicitudSat => ({
    tipo,
    estado,
    fecha_final: `${hasta} 23:59:59`,
    mensaje,
    created_at: pedida,
  });
  const ok = resumenDescargaSat(
    [
      s("emitido", "vacia", "2026-10-18", "2026-10-19T06:40:00Z"),
      s("recibido", "descargada", "2026-10-18", "2026-10-19T06:40:01Z"),
      s("recibido", "solicitada", "2026-10-19", "2026-10-20T06:40:01Z"),
      s("emitido", "descargada", "2026-10-17", "2026-10-18T06:40:00Z"),
    ],
    "2026-10-20",
  );
  assert.deepEqual(ok, { alDiaHasta: "2026-10-18", ultimaSolicitud: "2026-10-20T06:40:01Z", error: null, atrasada: false });

  const qx = resumenDescargaSat(
    [s("emitido", "error", "2026-10-18", "2026-10-19T06:40:00Z", "305 Certificado Inválido"), s("recibido", "error", "2026-10-18", "2026-10-19T06:40:01Z")],
    "2026-10-20",
  );
  assert.equal(qx.alDiaHasta, null);
  assert.equal(qx.error, "305 Certificado Inválido");
  assert.equal(qx.atrasada, true);

  const vieja = resumenDescargaSat([s("emitido", "vacia", "2026-10-15", "x"), s("recibido", "vacia", "2026-10-16", "x")], "2026-10-20");
  assert.equal(vieja.alDiaHasta, "2026-10-15");
  assert.equal(vieja.atrasada, true);
  assert.equal(resumenDescargaSat([], "2026-10-20").atrasada, false);
});
