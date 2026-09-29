import { Outlet } from "react-router-dom";

/** Una sola pantalla (Mario, 29-sep-2026): la lista de requisiciones abre
 * cada una con sus renglones; ahí mismo almacén compra en un paso y se ve
 * la orden de compra. Ya no hay pestaña aparte de resolución. */
export function RequisicionesLayout() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Requisiciones</h1>
      <Outlet />
    </div>
  );
}
