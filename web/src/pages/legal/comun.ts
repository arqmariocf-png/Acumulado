import { supabase, urlFuncion } from "../../lib/supabase";
import type { Profile } from "../../types/database";

/** Misma regla que auth_opera_legal(): admin o permiso 'legal'. */
export function operaLegal(perfil: Profile | null | undefined): boolean {
  if (!perfil) return false;
  return perfil.rol === "admin" || (perfil.modulos ?? []).includes("legal");
}

/** Misma regla que auth_autoriza_credito(): admin o dirección. */
export function autorizaCredito(perfil: Profile | null | undefined): boolean {
  return perfil?.rol === "admin" || perfil?.rol === "direccion";
}

export const TIPOS_ASUNTO: Record<string, string> = {
  laboral: "Laboral",
  civil: "Civil",
  mercantil: "Mercantil",
  fiscal: "Fiscal",
  administrativo: "Administrativo",
  penal: "Penal",
  contrato: "Contrato",
  otro: "Otro",
};

export const ESTATUS_ASUNTO: Record<string, string> = {
  abierto: "Abierto",
  en_tramite: "En trámite",
  suspendido: "Suspendido",
  convenio: "Convenio",
  cerrado_favorable: "Cerrado a favor",
  cerrado_desfavorable: "Cerrado en contra",
};

export const TIPOS_SEGUIMIENTO: Record<string, string> = {
  audiencia: "Audiencia",
  promocion: "Promoción",
  notificacion: "Notificación",
  acuerdo: "Acuerdo",
  reunion: "Reunión",
  pago: "Pago",
  nota: "Nota",
};

export function esCerrado(estatus: string): boolean {
  return estatus === "cerrado_favorable" || estatus === "cerrado_desfavorable";
}

/** Días que faltan para la próxima fecha (negativo = ya pasó). */
export function diasPara(fecha: string | null, hoy = new Date()): number | null {
  if (!fecha) return null;
  const [a, m, d] = fecha.split("-").map(Number);
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((Date.UTC(a, m - 1, d) - base) / 86_400_000);
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export interface DocumentoLegal {
  id: string;
  nombre: string | null;
  descripcion: string | null;
  subido_por_nombre: string | null;
  created_at: string;
  url: string | null;
}

export async function llamarDocumentos(metodo: "GET" | "POST", destino: { asunto?: string; contrato?: string; arrendamiento?: string }, archivo?: File, descripcion?: string) {
  const { data: sesion } = await supabase.auth.getSession();
  const token = sesion.session?.access_token;
  const base = urlFuncion("legal-documentos");
  let cuerpo: FormData | undefined;
  if (archivo) {
    cuerpo = new FormData();
    if (destino.asunto) cuerpo.append("asuntoId", destino.asunto);
    if (destino.contrato) cuerpo.append("contratoId", destino.contrato);
    if (destino.arrendamiento) cuerpo.append("arrendamientoId", destino.arrendamiento);
    if (descripcion) cuerpo.append("descripcion", descripcion);
    cuerpo.append("file", archivo);
  }
  const qs = destino.asunto
    ? `asunto=${encodeURIComponent(destino.asunto)}`
    : destino.arrendamiento
      ? `arrendamiento=${encodeURIComponent(destino.arrendamiento)}`
      : `contrato=${encodeURIComponent(destino.contrato ?? "")}`;
  const resp = await fetch(metodo === "GET" ? `${base}?${qs}` : base, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}` },
    body: cuerpo,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
  return json;
}
