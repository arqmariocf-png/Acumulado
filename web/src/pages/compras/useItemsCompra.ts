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
      // De 1,000 en 1,000: el servidor no regresa más por consulta y con lo
      // importado del backoffice ya son más de 1,300 (21-oct-2026).
      const todos: ItemCompra[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await supabase
          .from("compras_items")
          .select("id, clave, descripcion, unidad, categoria, iva, precio_referencia, notas, activo")
          .order("descripcion")
          .order("id")
          .range(desde, desde + 999);
        if (error) throw error;
        todos.push(...((data ?? []) as ItemCompra[]));
        if (!data || data.length < 1000) break;
      }
      return todos;
    },
  });
}
