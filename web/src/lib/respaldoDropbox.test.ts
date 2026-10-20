import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarConexion, tamano, urlAutorizacion } from "./respaldoDropbox.ts";

test("liga de autorización con token de larga duración", () => {
  assert.equal(
    urlAutorizacion(" abc123xyz789 "),
    "https://www.dropbox.com/oauth2/authorize?client_id=abc123xyz789&response_type=code&token_access_type=offline",
  );
});

test("revisión de los datos de conexión", () => {
  const codigo = "x".repeat(43);
  assert.equal(revisarConexion("abc123xyz789", "def456uvw000", codigo, "/Respaldo Acumulado"), null);
  assert.match(revisarConexion("abc", "def456uvw000", codigo, "/R") ?? "", /App key/);
  assert.match(revisarConexion("abc123xyz789", "", codigo, "/R") ?? "", /App secret/);
  assert.match(revisarConexion("abc123xyz789", "def456uvw000", "corto", "/R") ?? "", /código/);
  assert.match(revisarConexion("abc123xyz789", "def456uvw000", codigo, "Respaldo") ?? "", /empieza con/);
});

test("tamaños", () => {
  assert.equal(tamano(512), "512 B");
  assert.equal(tamano(2048), "2 KB");
  assert.equal(tamano(5 * 1024 * 1024), "5.0 MB");
});
