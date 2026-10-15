import { supabase } from "../../lib/supabase";
import { normalizarBusqueda } from "../../lib/buscadorCaptura";

/** Datos para imprimir órdenes (Laura, 15-oct-2026: "en el imprimible no
 * aparecen todos los datos"). Lo que no se pueda leer (RLS) simplemente no
 * se imprime. */

export interface Membrete {
  razon_social: string | null;
  rfc: string | null;
  domicilio: string | null;
  telefono: string | null;
  correo: string | null;
}

/** Razón social, RFC, domicilio, teléfono y correo de la empresa: primero lo
 * de `empresas` y, si falta, lo de "Datos legales de la empresa". */
export async function membreteEmpresa(empresaId: string): Promise<Membrete> {
  const [e, l] = await Promise.all([
    supabase.from("empresas").select("razon_social, rfc, domicilio_fiscal, telefono, correo").eq("id", empresaId).maybeSingle(),
    supabase.from("empresas_perfil_legal").select("razon_social, rfc, domicilio_legal, telefono, correo").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  const emp = (e.data ?? {}) as Record<string, string | null>;
  const leg = (l.error ? {} : l.data ?? {}) as Record<string, string | null>;
  return {
    razon_social: emp.razon_social || leg.razon_social || null,
    rfc: emp.rfc || leg.rfc || null,
    domicilio: emp.domicilio_fiscal || leg.domicilio_legal || null,
    telefono: emp.telefono || leg.telefono || null,
    correo: emp.correo || leg.correo || null,
  };
}

const lineas = (xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x && !!x.trim());

/** Ficha del proveedor (catálogo de compras) + correo/RFC de sus datos bancarios. */
export async function datosProveedor(nombre: string | null): Promise<{ rfc: string | null; datos: string[] }> {
  if (!nombre?.trim()) return { rfc: null, datos: [] };
  const { data: clave } = await supabase.rpc("fn_proveedor_clave", { p_nombre: nombre });
  if (!clave) return { rfc: null, datos: [] };
  const [f, b] = await Promise.all([
    supabase.from("proveedores").select("rfc, domicilio, contacto, telefono, correo").eq("clave", clave as string).maybeSingle(),
    supabase.from("proveedores_datos_bancarios").select("rfc, correo").eq("clave", clave as string).maybeSingle(),
  ]);
  const ficha = (f.data ?? {}) as Record<string, string | null>;
  const banc = (b.data ?? {}) as Record<string, string | null>;
  return {
    rfc: ficha.rfc || banc.rfc || null,
    datos: lineas([ficha.domicilio, ficha.contacto ? `Contacto: ${ficha.contacto}` : null, ficha.telefono ? `Tel. ${ficha.telefono}` : null, ficha.correo || banc.correo]),
  };
}

/** Cliente registrado con el mismo nombre (razón social o comercial); el de
 * la misma empresa gana. */
export async function datosCliente(nombre: string | null, empresaId: string | null): Promise<{ rfc: string | null; datos: string[] }> {
  if (!nombre?.trim()) return { rfc: null, datos: [] };
  const { data } = await supabase.from("clientes").select("empresa_id, razon_social, nombre_comercial, rfc, domicilio, codigo_postal, regimen_fiscal, email, telefono").eq("activo", true);
  const n = normalizarBusqueda(nombre);
  const cands = ((data ?? []) as Record<string, string | null>[]).filter((c) => normalizarBusqueda(c.razon_social) === n || (c.nombre_comercial && normalizarBusqueda(c.nombre_comercial) === n));
  const c = cands.find((x) => x.empresa_id === empresaId) ?? cands[0];
  if (!c) return { rfc: null, datos: [] };
  return {
    rfc: c.rfc || null,
    datos: lineas([
      c.razon_social && normalizarBusqueda(c.razon_social) !== n ? c.razon_social : null,
      [c.domicilio, c.codigo_postal ? `C.P. ${c.codigo_postal}` : null].filter(Boolean).join(", ") || null,
      c.regimen_fiscal ? `Régimen fiscal: ${c.regimen_fiscal}` : null,
      [c.telefono ? `Tel. ${c.telefono}` : null, c.email].filter(Boolean).join(" · ") || null,
    ]),
  };
}
