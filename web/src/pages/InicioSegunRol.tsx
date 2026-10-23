import { lazy, Suspense } from "react";
import { useAuth } from "../lib/auth";
import { useEsSocio } from "../lib/socio";
import { Inicio } from "./Inicio";
import { Socio } from "./Socio";
import { Organigrama } from "./Organigrama";

const InicioDireccion = lazy(() => import("./finanzas/InicioDireccion").then((m) => ({ default: m.InicioDireccion })));

/** "/" para el director general (admin) es su organigrama por áreas (Mario,
 * 23-oct-2026: "en mi inicio más que ver las empresas quiero ver mi
 * organigrama por áreas"); la vista de socio (organizaciones y empresas con
 * sus KPIs) sigue en /socio. Un socio (socios_organizacion) con
 * `inicio` también entra ahí. Dirección (Laura) arranca en saldos por
 * empresa (28-sep-2026); desde el 6-oct-2026 su inicio junta lo que le
 * espera (OC por autorizar, efectivo por confirmar), sus pendientes, saldos
 * por empresa y cuentas por pagar. El inicio completo le queda en /inicio.
 * Los demás, al inicio por rol. */
export function InicioSegunRol() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const { data: socio, isLoading } = useEsSocio(esAdmin ? undefined : perfil?.id);
  if (esAdmin) return <Organigrama />;
  if (isLoading) return null;
  if (socio?.some((s) => s.inicio)) return <Socio />;
  if (perfil?.rol === "direccion")
    return (
      <Suspense fallback={null}>
        <InicioDireccion />
      </Suspense>
    );
  return <Inicio />;
}
