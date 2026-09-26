import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { manifiestoDeMarca } from "./marcaManifiesto.ts";

describe("manifiestoDeMarca", () => {
  it("usa el nombre de la organización, no el de la plataforma", () => {
    const m = manifiestoDeMarca("ARSSA", null) as Record<string, string>;
    assert.equal(m.name, "ARSSA");
    assert.equal(m.short_name, "ARSSA");
    assert.equal(m.description, "Backoffice de ARSSA");
  });

  it("recorta el nombre corto sin cortar el largo", () => {
    const m = manifiestoDeMarca("Constructora Metropolitana del Centro", null) as Record<string, string>;
    assert.equal(m.name, "Constructora Metropolitana del Centro");
    assert.ok(m.short_name.length <= 12);
  });

  it("cae a Acumulado cuando no hay nombre", () => {
    assert.equal((manifiestoDeMarca("   ", null) as Record<string, string>).name, "Acumulado");
  });

  it("agrega el logotipo sin quitar los iconos de la plataforma", () => {
    const sin = manifiestoDeMarca("ARSSA", null) as { icons: unknown[] };
    const con = manifiestoDeMarca("ARSSA", "https://x/logo.png") as { icons: { src: string }[] };
    assert.equal(con.icons.length, sin.icons.length + 1);
    assert.ok(con.icons.some((i) => i.src === "/icon-512.png"));
    assert.ok(con.icons.some((i) => i.src === "https://x/logo.png"));
  });
});
