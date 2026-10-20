// Catálogos de empresas y clientes (21-oct-2026, Mario: "genera la sección de
// catálogos: empresas, proveedores, ítems, clientes; que puedan ser
// fácilmente manipulables por el área de Laura: agregar, quitar y editar").
// Lo que la pantalla revisa sin red: RFC, CLABE, campos mínimos, duplicados y
// el filtro de la lista. Puro, con pruebas.

import { normalizarBusqueda } from "./buscadorCaptura.ts";
import { clabeValida } from "./importarBancarios.ts";

/** RFC de persona moral (12) o física (13); acepta Ñ y &. */
export function rfcValido(rfc: string): boolean {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc.trim().toUpperCase());
}

export interface FormEmpresa {
  nombre: string;
  codigo: string;
  rfc: string;
  razon_social: string;
  domicilio_fiscal: string;
  telefono: string;
  correo: string;
  banco: string;
  cuenta_bancaria: string;
  clabe: string;
  sucursal_bancaria: string;
}

export interface FormCliente {
  empresa_id: string;
  razon_social: string;
  nombre_comercial: string;
  rfc: string;
  regimen_fiscal: string;
  codigo_postal: string;
  domicilio: string;
  email: string;
  telefono: string;
  notas: string;
}

const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim());

/** Devuelve el problema a corregir o null si la empresa se puede guardar. */
export function revisarEmpresa(f: FormEmpresa): string | null {
  if (f.nombre.trim().length < 2) return "Escribe el nombre de la empresa.";
  if (!/^[A-Z0-9]{2,10}$/.test(f.codigo.trim().toUpperCase())) return "El código lleva de 2 a 10 letras o números (ej. AEP).";
  if (f.rfc.trim() && !rfcValido(f.rfc)) return "El RFC no tiene el formato correcto (12 o 13 caracteres).";
  if (f.correo.trim() && !correoValido(f.correo)) return "El correo no es válido.";
  const clabe = f.clabe.replace(/\s/g, "");
  if (clabe && !clabeValida(clabe)) return "La CLABE debe tener 18 dígitos y su dígito verificador correcto.";
  const cuenta = f.cuenta_bancaria.replace(/\s/g, "");
  if (cuenta && !/^\d{6,14}$/.test(cuenta)) return "La cuenta bancaria lleva de 6 a 14 dígitos.";
  return null;
}

/** Devuelve el problema a corregir o null si el cliente se puede guardar. */
export function revisarCliente(f: FormCliente): string | null {
  if (!f.empresa_id) return "Elige la empresa a la que pertenece el cliente.";
  if (f.razon_social.trim().length < 3) return "Escribe la razón social o el nombre del cliente.";
  if (f.rfc.trim() && !rfcValido(f.rfc)) return "El RFC no tiene el formato correcto (12 o 13 caracteres).";
  if (f.codigo_postal.trim() && !/^\d{5}$/.test(f.codigo_postal.trim())) return "El código postal lleva 5 dígitos.";
  if (f.email.trim() && !correoValido(f.email)) return "El correo no es válido.";
  return null;
}

export interface ConNombre {
  id: string;
  nombre: string;
  rfc: string | null;
}

/** Otro renglón con el mismo RFC o el mismo nombre (sin acentos ni mayúsculas). */
export function duplicado<T extends ConNombre>(lista: T[], nombre: string, rfc: string, propio?: string | null): T | null {
  const n = normalizarBusqueda(nombre);
  const r = rfc.trim().toUpperCase();
  return (
    lista.find(
      (x) =>
        x.id !== propio &&
        ((r && (x.rfc ?? "").trim().toUpperCase() === r) || (n.length > 0 && normalizarBusqueda(x.nombre) === n)),
    ) ?? null
  );
}

/** Filtra por palabras en cualquier orden sobre los campos dados. */
export function filtrarPorTexto<T>(lista: T[], texto: string, campos: (x: T) => (string | null | undefined)[]): T[] {
  const palabras = normalizarBusqueda(texto).split(" ").filter(Boolean);
  if (palabras.length === 0) return lista;
  return lista.filter((x) => {
    const todo = normalizarBusqueda(campos(x).filter(Boolean).join(" "));
    return palabras.every((p) => todo.includes(p));
  });
}

/** Error al borrar por llave foránea → explicar que se desactive. */
export function mensajeBorrado(error: { code?: string; message: string }, que: string): string {
  if (error.code === "23503" || /foreign key|violates/i.test(error.message)) {
    return `No se puede borrar: ${que} ya se usa en cotizaciones, ventas, créditos o contratos. Desactívalo para que ya no salga.`;
  }
  return error.message;
}
