import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fechaHoyMx } from "../lib/conteoInventario";

// Aviso arriba de cualquier pantalla mientras haya un conteo de inventario
// abierto hoy (19-nov-2026, Mario: "todos van a contar… donde van a tener el
// módulo de manera directa"). Liga directa a /inventario/conteo.
export function AvisoConteoInventario() {
  const { perfil } = useAuth();
  const { pathname } = useLocation();
  const hoy = fechaHoyMx();
  const { data } = useQuery({
    queryKey: ["conteo-abierto-hoy", hoy, perfil?.grupo_id],
    enabled: !!perfil && perfil.rol !== "pendiente",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("conteos_inventario").select("id, nombre, fecha").eq("fecha", hoy).eq("estado", "abierto").maybeSingle();
      if (error) throw error;
      return (data as { id: string; nombre: string; fecha: string } | null) ?? null;
    },
  });
  if (!data || pathname.startsWith("/inventario/conteo")) return null;
  return (
    <div className="mx-auto mb-3 max-w-7xl px-4">
      <Link to="/inventario/conteo" className="block rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-100">
        📦 <span className="font-semibold">{data.nombre}: hoy todos contamos.</span> Entra, elige la empresa y captura cada ítem con su cantidad; cada uno recibe su etiqueta QR. <span className="underline">Ir al conteo</span>
      </Link>
    </div>
  );
}
