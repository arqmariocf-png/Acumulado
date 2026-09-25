import { useAuth } from "../lib/auth";
import { Inicio } from "./Inicio";
import { Socio } from "./Socio";

/** "/" para el director general (admin) es la vista de socio: todas las
 * organizaciones y empresas con sus KPIs; de ahí baja al organigrama de
 * cada empresa o del grupo. Para todos los demás, el inicio por rol. */
export function InicioSegunRol() {
  const { perfil } = useAuth();
  if (perfil?.rol === "admin") return <Socio />;
  return <Inicio />;
}
