// Encargados adicionales por obra y confirmación de entrega en obra
// (18-nov-2026, Mario: "necesito que pueda agregar a los supervisores varias
// obras para solicitar" y "ver de qué manera podemos confirmar las entregas
// en obra"). Reglas puras; la base las repite en `auth_es_de_la_obra`,
// `requisiciones_insert_encargado` y `fn_requisicion_confirmar_obra`.

export interface PerfilMin {
  id: string;
  rol: string;
}

export interface ObraMin {
  id: string;
  responsable_id?: string | null;
  comprador_id?: string | null;
}

/** Quién asigna encargados a una obra (misma regla que la policy
 * `proyecto_encargados_write`). */
export function puedeAsignarEncargados(rol: string | null | undefined): boolean {
  return ["admin", "corporativo", "direccion", "empresa"].includes(rol ?? "");
}

/** La persona es "de la obra": responsable, comprador o encargado adicional. */
export function esDeLaObra(perfil: PerfilMin | null | undefined, obra: ObraMin | null | undefined, encargos: Set<string> | string[]): boolean {
  if (!perfil || !obra) return false;
  const set = encargos instanceof Set ? encargos : new Set(encargos);
  return obra.responsable_id === perfil.id || obra.comprador_id === perfil.id || set.has(obra.id);
}

/** Quién puede pulsar "Ya lo recibí en obra" en una requisición (misma regla
 * que `fn_requisicion_confirmar_obra`): quien la pidió, los de la obra,
 * empresa, dirección, admin y corporativo. Nunca en canceladas ni recibidas. */
export function puedeConfirmarObra(
  perfil: PerfilMin | null | undefined,
  req: { estado: string; etapa?: string | null; solicitado_por?: string | null; proyecto_id?: string | null; proyectos?: ObraMin | null },
  encargos: Set<string> | string[],
): boolean {
  if (!perfil) return false;
  if (req.estado === "cancelada" || req.etapa === "recibida") return false;
  if (["admin", "corporativo", "empresa", "direccion"].includes(perfil.rol)) return true;
  if (req.solicitado_por === perfil.id) return true;
  const obra: ObraMin | null = req.proyectos ? { ...req.proyectos, id: req.proyectos.id ?? req.proyecto_id ?? "" } : req.proyecto_id ? { id: req.proyecto_id } : null;
  return esDeLaObra(perfil, obra, encargos);
}

/** Obras en las que la persona puede pedir: un responsable, las suyas (como
 * responsable, comprador o encargada); los demás, todo lo que la base le
 * deja ver (la policy decide). */
export function obrasParaPedir<T extends ObraMin>(perfil: PerfilMin | null | undefined, obras: T[], encargos: Set<string> | string[]): T[] {
  if (!perfil) return [];
  if (perfil.rol !== "responsable") return obras;
  return obras.filter((o) => esDeLaObra(perfil, o, encargos));
}

/** Texto del botón de confirmación según lo que falta. */
export function textoConfirmarObra(avance: { partidas?: number; en_obra?: number } | null | undefined): string {
  const partidas = avance?.partidas ?? 0;
  const enObra = avance?.en_obra ?? 0;
  if (partidas > 0 && enObra > 0 && enObra < partidas) return `Ya recibí en obra lo que falta (${partidas - enObra} de ${partidas})`;
  return "Ya lo recibí todo en obra";
}
