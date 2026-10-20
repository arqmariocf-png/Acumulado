import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { ItemCompra } from "../../lib/catalogoItems";

/** Catálogo propio de items de compras (21-oct-2026). Lo lee cualquiera de la
 * organización; lo usan la pantalla del catálogo, los artículos de proveedor y
 * la captura de requisiciones. */
export function useItemsCompra(habilitado = true) {
  return useQuery({
    queryKey: ["compras-items"],
    enabled: habilitado,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras_items")
        .select("id, clave, descripcion, unidad, categoria, iva, precio_referencia, notas, activo")
        .order("descripcion");
      if (error) throw error;
      return (data ?? []) as ItemCompra[];
    },
  });
}
