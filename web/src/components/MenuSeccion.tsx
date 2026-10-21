import { Link, useLocation } from "react-router-dom";
import type { SeccionMenu } from "../lib/menu";
import { atajosDeRuta, muestraBarra, seccionDeRuta, type AtajoBarra } from "../lib/menuSeccion";

// Barra fija con las demás pantallas de la sección en la que está la persona
// (Mario, 21-oct-2026: "para no tener que hacer scroll para ir a las
// ventanas correctas; aplícalo para todos"). Las secciones ya vienen
// acotadas por rol, módulo y permisos; en celular se desplaza de lado.
// Mide 44 px (h-11): lo que quiera quedar fijo debajo usa top-11.

export function MenuSeccion({ secciones }: { secciones: SeccionMenu[] }) {
  const { pathname, search } = useLocation();
  const actual = seccionDeRuta(secciones, pathname);
  if (!muestraBarra(actual)) return null;
  const atajos = atajosDeRuta(pathname, search);
  const sueltos = atajos.filter((a) => !actual.seccion.entradas.some((e) => e.ruta === a.despuesDe));
  const pastilla = (a: AtajoBarra) => (
    <Link
      key={a.ruta}
      to={a.ruta}
      aria-current={a.activo ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 ${a.activo ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {a.etiqueta}
    </Link>
  );
  return (
    <nav aria-label={`Pantallas de ${actual.seccion.titulo}`} className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-11 max-w-7xl items-center gap-2 overflow-x-auto px-4 text-sm [scrollbar-width:none]">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">{actual.seccion.titulo}</span>
        {actual.seccion.entradas.map((e) => {
          // Con un atajo activo (p. ej. el tablero de la obra) ese es el marcado.
          const activa = e === actual.entrada && !atajos.some((a) => a.activo);
          return [
            <Link
              key={e.ruta}
              to={e.ruta}
              title={e.descripcion}
              aria-current={activa ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 ${activa ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {e.etiqueta}
            </Link>,
            ...atajos.filter((a) => a.despuesDe === e.ruta).map(pastilla),
          ];
        })}
        {sueltos.map(pastilla)}
      </div>
    </nav>
  );
}
