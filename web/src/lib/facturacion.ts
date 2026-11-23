// Facturar con un clic (23-nov-2026, Mario: "conexión con factura.com para
// que las órdenes de venta se agreguen de inmediato y podamos facturar con un
// clic"). Reglas puras de la pantalla: catálogos del SAT que la gente ve
// (uso de CFDI, régimen, forma de pago, unidades), cómo se traducen los datos
// de la OV a lo que pide el CFDI (forma de pago en texto → clave, condición →
// PUE/PPD, unidad → clave SAT) y la validación antes de timbrar. La edge
// `facturacion-factura-com` vuelve a validar y arma el cuerpo.

export const USOS_CFDI: { clave: string; etiqueta: string }[] = [
  { clave: "G01", etiqueta: "G01 · Adquisición de mercancías" },
  { clave: "G03", etiqueta: "G03 · Gastos en general" },
  { clave: "I01", etiqueta: "I01 · Construcciones" },
  { clave: "I04", etiqueta: "I04 · Equipo de cómputo y accesorios" },
  { clave: "I05", etiqueta: "I05 · Dados, troqueles, moldes, matrices y herramental" },
  { clave: "I08", etiqueta: "I08 · Otra maquinaria y equipo" },
  { clave: "P01", etiqueta: "P01 · Por definir" },
  { clave: "S01", etiqueta: "S01 · Sin efectos fiscales" },
  { clave: "CP01", etiqueta: "CP01 · Pagos" },
];

export const REGIMENES_FISCALES: { clave: string; etiqueta: string }[] = [
  { clave: "601", etiqueta: "601 · General de Ley Personas Morales" },
  { clave: "603", etiqueta: "603 · Personas Morales con Fines no Lucrativos" },
  { clave: "605", etiqueta: "605 · Sueldos y Salarios" },
  { clave: "606", etiqueta: "606 · Arrendamiento" },
  { clave: "612", etiqueta: "612 · Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave: "616", etiqueta: "616 · Sin obligaciones fiscales" },
  { clave: "620", etiqueta: "620 · Sociedades Cooperativas de Producción" },
  { clave: "621", etiqueta: "621 · Incorporación Fiscal" },
  { clave: "622", etiqueta: "622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { clave: "623", etiqueta: "623 · Opcional para Grupos de Sociedades" },
  { clave: "625", etiqueta: "625 · Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { clave: "626", etiqueta: "626 · Régimen Simplificado de Confianza" },
];

export const FORMAS_PAGO_SAT: { clave: string; etiqueta: string }[] = [
  { clave: "01", etiqueta: "01 · Efectivo" },
  { clave: "02", etiqueta: "02 · Cheque nominativo" },
  { clave: "03", etiqueta: "03 · Transferencia electrónica de fondos" },
  { clave: "04", etiqueta: "04 · Tarjeta de crédito" },
  { clave: "28", etiqueta: "28 · Tarjeta de débito" },
  { clave: "99", etiqueta: "99 · Por definir" },
];

/** Claves de unidad del SAT más usadas, con el nombre que va en "Unidad". */
export const UNIDADES_SAT: { clave: string; nombre: string; alias: string[] }[] = [
  { clave: "H87", nombre: "Pieza", alias: ["pza", "pz", "pieza", "piezas", "pzas", "u", "unidad", "und"] },
  { clave: "KGM", nombre: "Kilogramo", alias: ["kg", "kgs", "kilo", "kilos", "kilogramo"] },
  { clave: "TNE", nombre: "Tonelada", alias: ["ton", "t", "tonelada", "toneladas"] },
  { clave: "MTR", nombre: "Metro", alias: ["m", "ml", "mt", "mts", "metro", "metros", "metro lineal"] },
  { clave: "MTK", nombre: "Metro cuadrado", alias: ["m2", "m²", "metro cuadrado"] },
  { clave: "MTQ", nombre: "Metro cúbico", alias: ["m3", "m³", "metro cubico", "metro cúbico"] },
  { clave: "LTR", nombre: "Litro", alias: ["l", "lt", "lts", "litro", "litros"] },
  { clave: "GLL", nombre: "Galón", alias: ["gal", "galon", "galón"] },
  { clave: "HUR", nombre: "Hora", alias: ["hr", "hrs", "hora", "horas"] },
  { clave: "DAY", nombre: "Día", alias: ["dia", "día", "dias", "días"] },
  { clave: "E48", nombre: "Unidad de servicio", alias: ["srv", "serv", "servicio", "servicios"] },
  { clave: "ACT", nombre: "Actividad", alias: ["act", "actividad"] },
  { clave: "XBX", nombre: "Caja", alias: ["caja", "cajas", "cja"] },
  { clave: "XBG", nombre: "Bolsa", alias: ["bolsa", "bolsas"] },
  { clave: "XSA", nombre: "Saco", alias: ["saco", "sacos", "bto", "bulto", "bultos"] },
  { clave: "XRO", nombre: "Rollo", alias: ["rollo", "rollos", "rll"] },
  { clave: "XPK", nombre: "Paquete", alias: ["paq", "paquete", "paquetes", "pack"] },
  { clave: "SET", nombre: "Juego", alias: ["juego", "juegos", "jgo", "kit", "set"] },
  { clave: "XLT", nombre: "Lote", alias: ["lote", "lotes"] },
  { clave: "PR", nombre: "Par", alias: ["par", "pares"] },
  { clave: "XTU", nombre: "Tubo", alias: ["tubo", "tubos", "tramo", "tramos"] },
  { clave: "XVI", nombre: "Viaje", alias: ["viaje", "viajes", "flete", "fletes"] },
  { clave: "C62", nombre: "Uno", alias: ["global", "lump sum"] },
];

const norm = (s: string | null | undefined) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .trim();

/** Clave de unidad del SAT para la unidad escrita en la OV ("PZA", "kg", "H87"…). */
export function claveUnidadSugerida(unidad: string | null | undefined): { clave: string; nombre: string } | null {
  const u = norm(unidad);
  if (!u) return null;
  const porClave = UNIDADES_SAT.find((x) => x.clave.toLowerCase() === u);
  if (porClave) return { clave: porClave.clave, nombre: porClave.nombre };
  const porAlias = UNIDADES_SAT.find((x) => x.alias.includes(u) || norm(x.nombre) === u);
  return porAlias ? { clave: porAlias.clave, nombre: porAlias.nombre } : null;
}

export function nombreUnidadSat(clave: string | null | undefined): string {
  const c = String(clave ?? "").toUpperCase();
  return UNIDADES_SAT.find((x) => x.clave === c)?.nombre ?? (c || "Pieza");
}

/** Forma de pago de la OV ("Transferencia electrónica de fondos", "Efectivo"…) → clave SAT. */
export function formaPagoSat(texto: string | null | undefined): string {
  const t = norm(texto);
  if (!t) return "99";
  if (/^\d{2}$/.test(t)) return t;
  if (t.includes("efectivo")) return "01";
  if (t.includes("cheque")) return "02";
  if (t.includes("transferencia") || t.includes("spei")) return "03";
  if (t.includes("credito") && t.includes("tarjeta")) return "04";
  if (t.includes("debito")) return "28";
  return "99";
}

/** Contado = PUE (una sola exhibición); crédito o anticipo = PPD (parcialidades). */
export function metodoPagoSugerido(condicion: string | null | undefined): "PUE" | "PPD" {
  const c = norm(condicion);
  return c === "credito" || c === "anticipo" ? "PPD" : "PUE";
}

/** La clave de 3 dígitos de un régimen guardado como "601 General de Ley…" o "601". */
export function regimenClave(texto: string | null | undefined): string {
  const m = String(texto ?? "").match(/\b(6\d\d)\b/);
  return m ? m[1] : "";
}

/** Régimen según el RFC: 13 caracteres = persona física (612 por defecto), 12 = moral (601). */
export function regimenPorRfc(rfc: string | null | undefined): string {
  const r = String(rfc ?? "").trim();
  if (r.length === 13) return "612";
  if (r.length === 12) return "601";
  return "";
}

export interface ConceptoCaptura {
  linea_id: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precio: number;
  iva: boolean;
  clave_prod_serv: string;
  clave_unidad: string;
}

export interface LineaOvFactura {
  id: string;
  concepto: string | null;
  unidad: string | null;
  cantidad: number | string | null;
  precio_base: number | string | null;
  iva: boolean | null;
  sat_code: string | null;
  clave_unidad: string | null;
  memoria?: { clave_prod_serv: string; clave_unidad: string; unidad?: string | null } | null;
  producto?: { clave_prod_serv: string | null; clave_unidad: string | null } | null;
}

/** Conceptos prellenados: clave guardada en la partida, si no la recordada
 * para esa descripción, si no la del producto del catálogo, si no la clave
 * por defecto de la empresa; la unidad se traduce a la clave del SAT. */
export function conceptosDesdeOv(lineas: LineaOvFactura[], defaults: { clave_prod_serv_default?: string | null; clave_unidad_default?: string | null }): ConceptoCaptura[] {
  return lineas
    .filter((l) => (l.concepto ?? "").trim() !== "" && Number(l.cantidad) > 0)
    .map((l) => {
      const sugerida = claveUnidadSugerida(l.unidad);
      return {
        linea_id: l.id,
        descripcion: (l.concepto ?? "").trim(),
        unidad: (l.unidad ?? "").trim(),
        cantidad: Number(l.cantidad),
        precio: Number(l.precio_base ?? 0),
        iva: l.iva !== false,
        clave_prod_serv: l.sat_code?.trim() || l.memoria?.clave_prod_serv || l.producto?.clave_prod_serv || defaults.clave_prod_serv_default || "",
        clave_unidad: l.clave_unidad?.trim().toUpperCase() || l.memoria?.clave_unidad || l.producto?.clave_unidad || sugerida?.clave || defaults.clave_unidad_default || "",
      };
    });
}

export interface ReceptorCaptura {
  cliente_id: string | null;
  razon_social: string;
  rfc: string;
  regimen_fiscal: string;
  codigo_postal: string;
  email: string;
  uso_cfdi: string;
}

export interface ClienteFiscal {
  id: string;
  razon_social: string;
  nombre_comercial?: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  codigo_postal: string | null;
  email: string | null;
  uso_cfdi: string | null;
  coincide?: boolean;
}

/** Receptor prellenado con el cliente registrado que coincide con el nombre
 * de la OV (o el único con RFC si solo hay uno igual); si no hay, el nombre
 * de la OV y lo demás en blanco para capturarlo una vez. */
export function receptorDesdeOv(cliente: string | null, clientes: ClienteFiscal[]): ReceptorCaptura {
  const c = clientes.find((x) => x.coincide) ?? null;
  const rfc = (c?.rfc ?? "").toUpperCase().trim();
  return {
    cliente_id: c?.id ?? null,
    razon_social: c?.razon_social ?? (cliente ?? "").trim(),
    rfc,
    regimen_fiscal: regimenClave(c?.regimen_fiscal) || regimenPorRfc(rfc),
    codigo_postal: c?.codigo_postal ?? "",
    email: c?.email ?? "",
    uso_cfdi: c?.uso_cfdi ?? "G03",
  };
}

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

export function revisarFactura(f: { receptor: ReceptorCaptura; conceptos: ConceptoCaptura[]; forma_pago: string; config: { con_llaves?: boolean; serie_id?: number | null } | null }): string[] {
  const p: string[] = [];
  if (!f.config?.con_llaves) p.push("La empresa no tiene llaves de factura.com: captúralas en Contabilidad › Facturación.");
  else if (!f.config.serie_id) p.push("Elige la serie con la que se timbra en Contabilidad › Facturación.");
  if (!RFC_RE.test(f.receptor.rfc.trim().toUpperCase())) p.push("El RFC del cliente no es válido.");
  if (!f.receptor.razon_social.trim()) p.push("Falta la razón social del cliente.");
  if (!/^\d{3}$/.test(f.receptor.regimen_fiscal)) p.push("Elige el régimen fiscal del cliente.");
  if (!/^\d{5}$/.test(f.receptor.codigo_postal.trim())) p.push("El código postal fiscal del cliente debe tener 5 dígitos.");
  if (!f.receptor.uso_cfdi) p.push("Elige el uso del CFDI.");
  if (!/^\d{2}$/.test(f.forma_pago)) p.push("Elige la forma de pago.");
  if (f.conceptos.length === 0) p.push("La orden no tiene partidas.");
  f.conceptos.forEach((c, i) => {
    if (!/^\d{8}$/.test(c.clave_prod_serv.trim())) p.push(`Partida ${i + 1} (${c.descripcion.slice(0, 30)}): falta la clave de producto/servicio del SAT (8 dígitos).`);
    if (!/^[A-Z0-9]{2,3}$/.test(c.clave_unidad.trim().toUpperCase())) p.push(`Partida ${i + 1} (${c.descripcion.slice(0, 30)}): falta la clave de unidad del SAT.`);
  });
  return p;
}

export function totalesCaptura(cs: Pick<ConceptoCaptura, "cantidad" | "precio" | "iva">[]): { subtotal: number; iva: number; total: number } {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let iva = 0;
  for (const c of cs) {
    const imp = r2(c.cantidad * c.precio);
    subtotal = r2(subtotal + imp);
    if (c.iva) iva = r2(iva + r2(imp * 0.16));
  }
  return { subtotal, iva, total: r2(subtotal + iva) };
}

/** Quién puede facturar desde la app (la base lo vuelve a preguntar). */
export function puedeFacturar(p: { rol: string; modulos?: string[] | null } | null | undefined): boolean {
  if (!p) return false;
  return p.rol === "admin" || p.rol === "direccion" || p.rol === "corporativo" || (p.modulos ?? []).includes("contabilidad");
}

export const MOTIVOS_CANCELACION: { clave: string; etiqueta: string }[] = [
  { clave: "02", etiqueta: "02 · Comprobante emitido con errores sin relación" },
  { clave: "01", etiqueta: "01 · Con errores, con relación (indica el UUID que la sustituye)" },
  { clave: "03", etiqueta: "03 · No se llevó a cabo la operación" },
  { clave: "04", etiqueta: "04 · Operación nominativa relacionada en la factura global" },
];
