// Importar el catálogo de proveedores del backoffice (nombre, RFC, banco,
// cuenta, CLABE) desde Excel/CSV (Mario, 30-sep-2026: "nuestro sistema no
// tiene esos datos y ya los tenemos"). Aquí solo se reconocen columnas y se
// valida cada fila; la base vuelve a validar en fn_proveedores_bancarios_importar.
// Nunca se acepta un número de tarjeta (15-16 dígitos) como cuenta.

export interface FilaBancaria {
  nombre: string;
  beneficiario: string | null;
  banco: string | null;
  cuenta: string | null;
  clabe: string | null;
  rfc: string | null;
  correo: string | null;
  error: string | null;
}

type Campo = "nombre" | "beneficiario" | "banco" | "cuenta" | "clabe" | "rfc" | "correo";

const SINONIMOS: Record<Campo, string[]> = {
  nombre: ["proveedor", "nombre", "razonsocial", "nombreproveedor", "razonsocialproveedor", "nombrerazonsocial"],
  beneficiario: ["beneficiario", "titular", "nombrebeneficiario", "titulardelacuenta"],
  banco: ["banco", "bancoproveedor", "institucion", "institucionbancaria"],
  cuenta: ["cuenta", "cuentaproveedor", "numerodecuenta", "nocuenta", "cuentabancaria"],
  clabe: ["clabe", "clabeinterbancaria", "cuentaclabe", "clabeproveedor"],
  rfc: ["rfc", "rfcproveedor"],
  correo: ["correo", "email", "correoelectronico", "mail"],
};

export function normalizarEncabezado(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Dígito verificador de la CLABE (pesos 3, 7, 1). */
export function clabeValida(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(clabe[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(clabe[17]);
}

function soloDigitos(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d || null;
}

/** "CUENTA: 01600779512, CLABE: 042650016007795121" (como lo muestra el backoffice). */
export function separarCuentaYClabe(texto: string): { cuenta: string | null; clabe: string | null } {
  const clabe = /CLABE\D*(\d{18})/i.exec(texto)?.[1] ?? /(?:^|\D)(\d{18})(?:\D|$)/.exec(texto)?.[1] ?? null;
  const cuenta = /CUENTA\D*?(\d{6,14})(?:\D|$)/i.exec(texto)?.[1] ?? null;
  return { cuenta, clabe };
}

/** Busca la fila de encabezados en las primeras filas y convierte el resto. */
export function filasDesdeTabla(tabla: (string | null)[][]): { filas: FilaBancaria[]; columnas: Partial<Record<Campo, number>>; faltaNombre: boolean } {
  let inicio = -1;
  let columnas: Partial<Record<Campo, number>> = {};
  for (let i = 0; i < Math.min(tabla.length, 15); i++) {
    const encontrados: Partial<Record<Campo, number>> = {};
    tabla[i].forEach((celda, j) => {
      const h = normalizarEncabezado(celda ?? "");
      if (!h) return;
      for (const campo of Object.keys(SINONIMOS) as Campo[]) {
        if (encontrados[campo] === undefined && SINONIMOS[campo].includes(h)) encontrados[campo] = j;
      }
    });
    if (encontrados.nombre !== undefined && (encontrados.clabe !== undefined || encontrados.cuenta !== undefined)) {
      inicio = i;
      columnas = encontrados;
      break;
    }
  }
  if (inicio < 0) return { filas: [], columnas: {}, faltaNombre: true };

  const val = (fila: (string | null)[], campo: Campo) => {
    const j = columnas[campo];
    const v = j === undefined ? null : (fila[j] ?? "").toString().trim();
    return v || null;
  };

  const filas: FilaBancaria[] = [];
  for (const fila of tabla.slice(inicio + 1)) {
    const nombre = val(fila, "nombre");
    if (!nombre) continue;
    let cuenta = soloDigitos(val(fila, "cuenta"));
    let clabe = soloDigitos(val(fila, "clabe"));
    // Columna combinada "CUENTA: …, CLABE: …".
    const textoCuenta = val(fila, "cuenta") ?? "";
    if (/clabe/i.test(textoCuenta)) {
      const s = separarCuentaYClabe(textoCuenta);
      cuenta = s.cuenta;
      clabe = clabe ?? s.clabe;
    }
    let error: string | null = null;
    if (cuenta && (cuenta.length === 15 || cuenta.length === 16)) {
      cuenta = null;
      error = "parece número de tarjeta: no se guarda";
    }
    if (clabe && !clabeValida(clabe)) {
      error = "CLABE inválida (dígito verificador)";
      clabe = null;
    }
    if (!clabe && !cuenta) error = error ?? "sin cuenta ni CLABE";
    filas.push({
      nombre,
      beneficiario: val(fila, "beneficiario"),
      banco: val(fila, "banco"),
      cuenta,
      clabe,
      rfc: val(fila, "rfc")?.toUpperCase() ?? null,
      correo: val(fila, "correo"),
      error: !clabe && !cuenta ? error : error && clabe ? null : error,
    });
  }
  return { filas, columnas, faltaNombre: false };
}

/** CSV sencillo (coma o punto y coma, comillas dobles). */
export function tablaDesdeCsv(texto: string): string[][] {
  const lineas = texto.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const sep = (lineas[0] ?? "").split(";").length > (lineas[0] ?? "").split(",").length ? ";" : ",";
  return lineas.map((linea) => {
    const celdas: string[] = [];
    let actual = "";
    let comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') {
        if (comillas && linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else comillas = !comillas;
      } else if (c === sep && !comillas) {
        celdas.push(actual);
        actual = "";
      } else actual += c;
    }
    celdas.push(actual);
    return celdas;
  });
}
