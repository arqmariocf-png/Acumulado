import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// Tablero de entrada: iconos grandes y, en cada uno, cuántas cosas hay
// esperando ahí. La idea es abrirlo desde el celular y saber de un vistazo
// dónde hay que meterse, sin recorrer el menú módulo por módulo.
//
// Cada contador sale de una vista real y RLS ya la limita a lo que le toca a
// quien consulta -- un supervisor ve el pendiente de SU obra, no el del grupo.

/* ---------- iconos ---------- */

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONOS = {
  movimientos: (
    <Icono>
      <path d="M3 7h13M3 7l3-3M3 7l3 3" />
      <path d="M21 17H8m13 0-3-3m3 3-3 3" />
    </Icono>
  ),
  requisiciones: (
    <Icono>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
      <path d="m9 13 2 2 4-4" />
    </Icono>
  ),
  precios: (
    <Icono>
      <path d="M4 4h16v5H4z" />
      <path d="M4 13h7v7H4zM13 13h7v7h-7z" />
    </Icono>
  ),
  inventario: (
    <Icono>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </Icono>
  ),
  rh: (
    <Icono>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3 3 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2" />
    </Icono>
  ),
  carga: (
    <Icono>
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icono>
  ),
  saldos: (
    <Icono>
      <path d="M3 6h18v12H3z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7 12h.01M17 12h.01" />
    </Icono>
  ),
  prestamos: (
    <Icono>
      <path d="M7 4h10v6H7zM7 14h10v6H7z" />
      <path d="M12 10v4" />
    </Icono>
  ),
  fiscal: (
    <Icono>
      <path d="M6 3h12v18H6z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </Icono>
  ),
  panel: (
    <Icono>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icono>
  ),
  admin: (
    <Icono>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M19.1 4.9 17 7m-10 10-2.1 2.1" />
    </Icono>
  ),
  pendientes: (
    <Icono>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icono>
  ),
};

/* ---------- contadores ---------- */

function useConteo(clave: string, activo: boolean, consulta: () => Promise<number>) {
  const { data } = useQuery({
    queryKey: ["inicio-conteo", clave],
    enabled: activo,
    // Un contador viejo por unos minutos es preferible a golpear seis vistas
    // cada vez que alguien regresa al inicio desde un módulo.
    staleTime: 60_000,
    queryFn: consulta,
  });
  return data;
}


/* ---------- tarjeta ---------- */

function Mosaico({
  a,
  etiqueta,
  descripcion,
  icono,
  conteo,
}: {
  a: string;
  etiqueta: string;
  descripcion: string;
  icono: ReactNode;
  conteo?: number;
}) {
  const hayPendiente = (conteo ?? 0) > 0;

  return (
    <Link
      to={a}
      className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm active:scale-[0.99]"
    >
      <div className="flex items-start justify-between">
        <span className={hayPendiente ? "text-slate-900" : "text-slate-400"}>{icono}</span>
        {conteo !== undefined && (
          <span
            className={`min-w-7 rounded-full px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${
              hayPendiente ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400"
            }`}
          >
            {conteo}
          </span>
        )}
      </div>
      <p className="mt-3 font-medium text-slate-900">{etiqueta}</p>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">
        {conteo === undefined ? descripcion : hayPendiente ? descripcion : "Sin pendientes"}
      </p>
    </Link>
  );
}

/* ---------- pantalla ---------- */

export function Inicio() {
  const { perfil } = useAuth();
  const rol = perfil?.rol;
  const esAdmin = rol === "admin";

  // Mismo criterio que el menú de arriba: un supervisor y almacén no tienen
  // nada que hacer en los módulos financieros, así que ni se les pintan.
  const soloRequisicionesYPrecios = rol === "responsable";
  const esAlmacen = rol === "almacen";
  const esRhDocumentos = rol === "rh_documentos";
  const veFinanzas = !soloRequisicionesYPrecios && !esAlmacen && !esRhDocumentos;
  const veRH = rol === "rh" || esRhDocumentos || esAdmin;
  const veSaldos = rol === "corporativo" || rol === "direccion" || esAdmin;
  const veInventario = veFinanzas || esAlmacen;
  const vePrecios = true;
  const veRequisiciones = true;

  const etapaPu =
    rol === "responsable"
      ? "borrador"
      : rol === "almacen"
        ? "en_revision_material"
        : rol === "direccion"
          ? "material_confirmado"
          : "autorizado";

  const movimientos = useConteo("movimientos", veFinanzas, async () => {
    const { data, error } = await supabase.from("v_pendientes_por_empresa").select("ambiguos, duplicados, faltantes");
    if (error) throw error;
    return (data ?? []).reduce(
      (s: number, f: Record<string, number>) =>
        s + Number(f.ambiguos ?? 0) + Number(f.duplicados ?? 0) + Number(f.faltantes ?? 0),
      0,
    );
  });

  const requisiciones = useConteo("requisiciones", veRequisiciones, async () => {
    const { count, error } = await supabase
      .from("avance_resolucion_linea")
      .select("*", { count: "exact", head: true })
      .gt("cantidad_sin_resolver", 0);
    if (error) throw error;
    return count ?? 0;
  });

  const precios = useConteo("precios", vePrecios, async () => {
    const { count, error } = await supabase
      .from("v_pu_analisis_costeo")
      .select("*", { count: "exact", head: true })
      .eq("estado", etapaPu);
    if (error) throw error;
    return count ?? 0;
  });

  // Sólo 'parcial': una orden a medio recibir sí es algo que alguien tiene que
  // cerrar. 'sin_recibir' abarca las mil y pico de órdenes históricas que
  // nunca pasaron por almacén, y como contador no dice nada -- un tablero que
  // marca 1162 pendientes permanentes deja de leerse a la semana.
  const inventario = useConteo("inventario", veInventario, async () => {
    const { count, error } = await supabase
      .from("avance_recepcion_oc")
      .select("*", { count: "exact", head: true })
      .eq("estado_recepcion", "parcial");
    if (error) throw error;
    return count ?? 0;
  });

  const rhFaltantes = useConteo("rh", veRH, async () => {
    const { count, error } = await supabase
      .from("v_documentos_faltantes_personal")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  });

  const carga = useConteo("carga", veFinanzas, async () => {
    const { count, error } = await supabase
      .from("v_estado_carga_empresa")
      .select("*", { count: "exact", head: true })
      .is("ultima_carga_estado_cuenta", null);
    if (error) throw error;
    return count ?? 0;
  });

  const mosaicos = [
    veRequisiciones && {
      a: "/requisiciones",
      etiqueta: "Requisiciones",
      descripcion: "renglones sin resolver",
      icono: ICONOS.requisiciones,
      conteo: requisiciones,
    },
    vePrecios && {
      a: "/precios",
      etiqueta: "Precios unitarios",
      descripcion: "análisis esperando tu paso",
      icono: ICONOS.precios,
      conteo: precios,
    },
    veInventario && {
      a: "/inventario",
      etiqueta: "Inventario",
      descripcion: "órdenes recibidas a medias",
      icono: ICONOS.inventario,
      conteo: inventario,
    },
    veFinanzas && {
      a: "/movimientos",
      etiqueta: "Movimientos",
      descripcion: "por revisar (ambiguos, duplicados o sin factura)",
      icono: ICONOS.movimientos,
      conteo: movimientos,
    },
    veFinanzas && {
      a: "/carga",
      etiqueta: "Carga",
      descripcion: "empresas sin estado de cuenta",
      icono: ICONOS.carga,
      conteo: carga,
    },
    veRH && {
      a: "/rh",
      etiqueta: "Recursos humanos",
      descripcion: "documentos faltantes en expedientes",
      icono: ICONOS.rh,
      conteo: rhFaltantes,
    },
    veFinanzas && {
      a: "/pendientes",
      etiqueta: "Pendientes",
      descripcion: "concentrado por proveedor",
      icono: ICONOS.pendientes,
    },
    veSaldos && {
      a: "/saldos",
      etiqueta: "Saldos diarios",
      descripcion: "corte por cuenta bancaria",
      icono: ICONOS.saldos,
    },
    veFinanzas && {
      a: "/prestamos-intercompania",
      etiqueta: "Préstamos entre empresas",
      descripcion: "movimientos intercompañía",
      icono: ICONOS.prestamos,
    },
    veFinanzas && {
      a: "/perfil-fiscal",
      etiqueta: "Perfil fiscal",
      descripcion: "coeficiente, ISR y pérdidas",
      icono: ICONOS.fiscal,
    },
    veFinanzas && {
      a: "/dashboard",
      etiqueta: "Panel de indicadores",
      descripcion: "KPIs, carga por empresa y saldos",
      icono: ICONOS.panel,
    },
    esAdmin && {
      a: "/admin",
      etiqueta: "Administración",
      descripcion: "usuarios, reglas y proyectos",
      icono: ICONOS.admin,
    },
  ].filter(Boolean) as {
    a: string;
    etiqueta: string;
    descripcion: string;
    icono: ReactNode;
    conteo?: number;
  }[];

  const totalPendiente = [requisiciones, precios, inventario, movimientos, carga, rhFaltantes]
    .filter((n): n is number => typeof n === "number")
    .reduce((s, n) => s + n, 0);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">
          {perfil?.nombre ? `Hola, ${perfil.nombre.split(" ")[0]}` : "Inicio"}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {totalPendiente > 0
            ? `Tienes ${totalPendiente} ${totalPendiente === 1 ? "cosa" : "cosas"} esperándote.`
            : "No tienes nada pendiente."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {mosaicos.map((m) => (
          <Mosaico key={m.a} {...m} />
        ))}
      </div>
    </div>
  );
}
