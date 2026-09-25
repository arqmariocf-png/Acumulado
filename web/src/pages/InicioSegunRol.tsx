import { useAuth } from "../lib/auth";
import { useEsSocio } from "../lib/socio";
import { Inicio } from "./Inicio";
import { Socio } from "./Socio";

/** "/" para el director general (admin) es la vista de socio: todas las
 * organizaciones y empresas con sus KPIs. Un socio (socios_organizacion) con
 * `inicio` también entra ahí; los demás, al inicio por rol. */
export function InicioSegunRol() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const { data: socio, isLoading } = useEsSocio(esAdmin ? undefined : perfil?.id);
  if (esAdmin) return <Socio />;
  if (isLoading) return null;
  if (socio?.some((s) => s.inicio)) return <Socio />;
  return <Inicio />;
}
