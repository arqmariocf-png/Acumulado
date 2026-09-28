import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/** Empresas que la persona maneja, con nombre (RLS deja ver todas las de la
 * organización; aquí se acotan al alcance para que ningún selector ofrezca
 * una empresa cuyos datos no va a poder ver). */
export function useEmpresasAlcance() {
  const { empresasAlcance, veTodasLasEmpresas } = useAuth();
  const clave = veTodasLasEmpresas ? "todas" : empresasAlcance.join(",");
  return useQuery({
    queryKey: ["empresas-alcance", clave],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      const filas = (data ?? []) as { id: string; nombre: string; codigo: string }[];
      return veTodasLasEmpresas ? filas : filas.filter((e) => empresasAlcance.includes(e.id));
    },
  });
}

/** Selector de empresa de una pantalla, ligado a la "empresa activa" del
 * encabezado (28-sep-2026): quien maneja una sola ve su nombre; quien maneja
 * varias elige; "Todas" (`vacio`) solo se ofrece a quien ve todas. */
export function SelectorEmpresa({
  value,
  onChange,
  vacio = "Todas las empresas",
  className = "rounded border border-slate-300 px-2 py-1.5 text-sm",
  required = false,
  compacto = false,
}: {
  value: string;
  onChange: (empresaId: string) => void;
  /** Etiqueta de la opción sin empresa (todas / selecciona); null = sin esa opción. */
  vacio?: string | null;
  className?: string;
  required?: boolean;
  compacto?: boolean;
}) {
  const { empresasAlcance, veTodasLasEmpresas, eligeEmpresa } = useAuth();
  const { data: empresas } = useEmpresasAlcance();
  if (!eligeEmpresa) {
    const unica = empresas?.find((e) => e.id === (value || empresasAlcance[0]));
    return <span className={compacto ? "text-xs text-slate-500" : "text-sm text-slate-600"}>{unica ? (compacto ? unica.codigo || unica.nombre : unica.nombre) : "Tu empresa"}</span>;
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required} className={className} title="Empresa activa: todas las pantallas se filtran por esta empresa">
      {veTodasLasEmpresas && vacio !== null && <option value="">{vacio}</option>}
      {!veTodasLasEmpresas && !value && <option value="">Elige empresa…</option>}
      {empresas?.map((e) => (
        <option key={e.id} value={e.id}>
          {compacto ? e.codigo || e.nombre : e.nombre}
        </option>
      ))}
    </select>
  );
}
