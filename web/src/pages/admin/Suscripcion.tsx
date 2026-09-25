import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { EstadoSuscripcion, Pago, PlanEscalon } from "../../types/database";

const dinero = (centavos: number, moneda: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(centavos / 100);

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" }) : "—";

const DESCRIPCION_ESTADO: Record<EstadoSuscripcion, string> = {
  prueba: "En periodo de prueba. Registra una tarjeta antes de que termine para no perder la captura.",
  activa: "Al corriente. El cobro se hace solo cada mes con la tarjeta registrada.",
  periodo_gracia: "El último cobro no se pudo realizar. Actualiza la tarjeta antes de que termine la gracia.",
  suspendida: "Sin pago al corriente: la información se puede consultar y exportar, pero no capturar.",
  cancelada: "Suscripción cancelada: la información se puede consultar y exportar, pero no capturar.",
};

const COLOR_ESTADO: Record<EstadoSuscripcion, string> = {
  prueba: "bg-sky-100 text-sky-800",
  activa: "bg-emerald-100 text-emerald-800",
  periodo_gracia: "bg-amber-100 text-amber-900",
  suspendida: "bg-red-100 text-red-800",
  cancelada: "bg-slate-200 text-slate-700",
};

// Pantalla de suscripción de la organización. El alta y el cambio de tarjeta
// se hacen en el dominio de la pasarela: aquí solo se muestra el estado y se
// manda para allá. La tarjeta nunca se captura en esta aplicación.
export function Suscripcion() {
  const { suscripcion, grupo, recargarOrganizacion } = useAuth();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al volver de la pasarela el estado ya cambió del otro lado, pero este
  // navegador todavía trae el de antes.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("pago")) {
      void recargarOrganizacion();
    }
  }, [recargarOrganizacion]);

  const { data: escalones } = useQuery({
    queryKey: ["plan-escalones", suscripcion?.plan_clave],
    enabled: !!suscripcion,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("plan_escalones")
        .select("*")
        .eq("plan_clave", suscripcion!.plan_clave)
        .order("desde_usuarios");
      if (err) throw err;
      return data as PlanEscalon[];
    },
  });

  const { data: pagos } = useQuery({
    queryKey: ["pagos", grupo?.id],
    enabled: !!grupo,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("pagos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(24);
      if (err) throw err;
      return data as Pago[];
    },
  });

  async function irAPasarela() {
    setEnviando(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("suscripcion-checkout", {
      body: { urlRegreso: `${window.location.origin}/admin/suscripcion?pago=1` },
    });
    setEnviando(false);
    if (err || !data?.url) {
      setError(err?.message ?? data?.error ?? "No se pudo abrir la pasarela de pago");
      return;
    }
    window.location.href = data.url;
  }

  if (!suscripcion) return <p className="text-sm text-slate-500">Esta organización no tiene una suscripción dada de alta.</p>;

  const tieneTarjeta = !!suscripcion.metodo_pago_ultimos4;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-medium text-slate-900">Plan {suscripcion.plan_nombre}</h2>
              <span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[suscripcion.estado]}`}>
                {suscripcion.estado.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {dinero(suscripcion.total_mensual_centavos, suscripcion.moneda)}
              <span className="ml-1 text-sm font-normal text-slate-500">al mes</span>
            </p>
            <p className="mt-0.5 text-sm text-slate-500">
              {suscripcion.usuarios_facturables}{" "}
              {suscripcion.usuarios_facturables === 1 ? "usuario" : "usuarios"} ×{" "}
              {dinero(suscripcion.precio_unitario_centavos, suscripcion.moneda)} c/u
            </p>
            <p className="mt-2 max-w-xl text-sm text-slate-600">{DESCRIPCION_ESTADO[suscripcion.estado]}</p>
          </div>

          <button
            onClick={irAPasarela}
            disabled={enviando}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {enviando ? "Abriendo…" : tieneTarjeta ? "Administrar pago" : "Registrar tarjeta"}
          </button>
        </div>

        <dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase text-slate-500">Tarjeta domiciliada</dt>
            <dd className="mt-1 text-slate-900">
              {tieneTarjeta ? (
                <span className="capitalize">
                  {suscripcion.metodo_pago_marca} ···· {suscripcion.metodo_pago_ultimos4}
                </span>
              ) : (
                <span className="text-slate-400">Sin registrar</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">
              {suscripcion.estado === "periodo_gracia" ? "Gracia hasta" : "Periodo pagado hasta"}
            </dt>
            <dd className="mt-1 text-slate-900">
              {fecha(suscripcion.estado === "periodo_gracia" ? suscripcion.gracia_hasta : suscripcion.periodo_fin)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Captura</dt>
            <dd className="mt-1 text-slate-900">{suscripcion.puede_escribir ? "Habilitada" : "Solo lectura"}</dd>
          </div>
        </dl>

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Los datos de la tarjeta se capturan y se guardan en la pasarela de pago, nunca en Acumulado. Aquí solo se conservan la
          marca y los últimos cuatro dígitos para que puedas reconocerla.
        </p>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-medium text-slate-900">Paquetes</h2>
        <p className="mb-3 text-sm text-slate-500">
          El precio del paquete aplica a todos los usuarios, no solo a los adicionales: al llegar a 5, los cinco bajan de precio.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full max-w-lg text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Usuarios</th>
                <th className="px-3 py-2 text-right">Precio por usuario</th>
              </tr>
            </thead>
            <tbody>
              {escalones?.map((e, i) => {
                const siguiente = escalones[i + 1];
                const rango = siguiente ? `${e.desde_usuarios} a ${siguiente.desde_usuarios - 1}` : `${e.desde_usuarios} o más`;
                const vigente = suscripcion.precio_unitario_centavos === e.precio_unitario_centavos;
                return (
                  <tr key={e.desde_usuarios} className={`border-t border-slate-100 ${vigente ? "bg-emerald-50/60" : ""}`}>
                    <td className="px-3 py-2">
                      {rango}
                      {vigente && <span className="ml-2 text-xs text-emerald-700">tu paquete</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{dinero(e.precio_unitario_centavos, suscripcion.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-slate-900">Historial de cobros</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Periodo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {pagos?.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{fecha(p.pagado_at ?? p.created_at)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {p.periodo_inicio ? `${fecha(p.periodo_inicio)} – ${fecha(p.periodo_fin)}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={p.estado === "pagado" ? "text-emerald-700" : "text-red-700"}>{p.estado}</span>
                    {p.detalle_error && <span className="ml-2 text-xs text-slate-500">{p.detalle_error}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{dinero(p.monto_centavos, p.moneda)}</td>
                </tr>
              ))}
              {(!pagos || pagos.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500">
                    Todavía no hay cobros registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
