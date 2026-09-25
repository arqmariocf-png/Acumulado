import { useAuth } from "../lib/auth";
import { Inicio } from "./Inicio";
import { Organigrama } from "./Organigrama";

/** "/" para el director general es el organigrama por áreas; para todos los
 * demás, el inicio con indicadores y mosaicos por rol. */
export function InicioSegunRol() {
  const { perfil } = useAuth();
  if (perfil?.rol === "admin") return <Organigrama />;
  return <Inicio />;
}
