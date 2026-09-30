import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { puedePedir, totalSeleccion, type PedidoComedor, type PlatilloMenu } from "../../lib/comedor";
import { hoyMx, mensajeError, useConfigComedor } from "./comun";

interface FilaMenu {
  platillo_id: string;
  cupo: number | null;
  comedor_platillos: { nombre: string; descripcion: string | null; categoria: string | null; precio: number } | null;
}

/** El trabajador pide su comida del día (o de mañana) a descuento de nómina. */
export function PedirComida() {
  const queryClient = useQueryClient();
  const { data: config } = useConfigComedor();
  const [fecha, setFecha] = useState(hoyMx());
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: menu = [] } = useQuery({
    queryKey: ["comedor", "menu", fecha],
    queryFn: async () => {
      const { data, error } = await supabase.from("comedor_menu").select("platillo_id, cupo, comedor_platillos(nombre, descripcion, categoria, precio)").eq("fecha", fecha);
      if (error) throw error;
      return (data ?? []) as unknown as FilaMenu[];
    },
  });

  const { data: misPedidos = [] } = useQuery({
    queryKey: ["comedor", "mis-pedidos"],
    queryFn: async () => {
      const { data: sesion } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("v_comedor_pedidos")
        .select("*")
        .eq("profile_id", sesion.session?.user.id ?? "")
        .gte("fecha", hoyMx(-31))
        .order("fecha", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PedidoComedor[];
    },
  });

  const platillos: PlatilloMenu[] = useMemo(
    () => menu.filter((m) => m.comedor_platillos).map((m) => ({ platillo_id: m.platillo_id, nombre: m.comedor_platillos!.nombre, precio: Number(m.comedor_platillos!.precio) })),
    [menu],
  );
  const pedidoDelDia = misPedidos.find((p) => p.fecha === fecha && p.estado !== "cancelado");
  const abierto = !!config && puedePedir(fecha, config.hora_limite.slice(0, 5));
  const total = totalSeleccion(platillos, cantidades);
  const porDescontar = misPedidos.filter((p) => p.estado === "entregado" && !p.descuento_aplicado_en).reduce((s, p) => s + Number(p.total), 0);

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["comedor"] });

  const pedir = useMutation({
    mutationFn: async () => {
      const lineas = Object.entries(cantidades)
        .filter(([, n]) => n > 0)
        .map(([platillo_id, cantidad]) => ({ platillo_id, cantidad }));
      if (lineas.length === 0) throw new Error("Elige al menos un platillo.");
      const { error } = await supabase.rpc("fn_comedor_pedir", { p_fecha: fecha, p_lineas: lineas, p_nota: nota.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Listo, tu pedido quedó registrado. Se descuenta de tu nómina cuando la cocina lo entregue.");
      setCantidades({});
      refrescar();
    },
    onError: (e) => setAviso(mensajeError(e)),
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("¿Cancelar tu pedido de este día?")) return false;
      const { error } = await supabase.rpc("fn_comedor_cancelar", { p_pedido: id });
      if (error) throw error;
      return true;
    },
    onSuccess: (hecho) => {
      if (hecho) {
        setAviso("Pedido cancelado.");
        refrescar();
      }
    },
    onError: (e) => setAviso(mensajeError(e)),
  });

  if (!config) return <p className="text-sm text-slate-500">El comedor todavía no está configurado para tu organización.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { f: hoyMx(), t: "Hoy" },
          { f: hoyMx(1), t: "Mañana" },
        ].map((o) => (
          <button
            key={o.f}
            type="button"
            onClick={() => {
              setFecha(o.f);
              setCantidades({});
              setAviso(null);
            }}
            className={`rounded-full px-3 py-1 text-sm ${fecha === o.f ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
          >
            {o.t} · {o.f}
          </button>
        ))}
        <span className="text-xs text-slate-500">Se pide hasta las {config.hora_limite.slice(0, 5)} del mismo día.</span>
      </div>

      {pedidoDelDia && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <div className="font-medium">Tu pedido: {pedidoDelDia.detalle}</div>
          <div>
            {moneda(Number(pedidoDelDia.total))} · {pedidoDelDia.estado === "entregado" ? "entregado" : "por entregar"}
            {pedidoDelDia.estado === "pedido" && abierto && (
              <button type="button" onClick={() => cancelar.mutate(pedidoDelDia.id)} className="ml-3 text-xs text-red-700 underline">
                Cancelar
              </button>
            )}
          </div>
          {pedidoDelDia.estado === "pedido" && abierto && <div className="text-xs text-emerald-800">Si eliges otra vez abajo, tu pedido se reemplaza.</div>}
        </div>
      )}

      {platillos.length === 0 ? (
        <p className="text-sm text-slate-500">La cocina todavía no publica el menú de este día.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {menu
            .filter((m) => m.comedor_platillos)
            .map((m) => {
              const n = cantidades[m.platillo_id] ?? 0;
              return (
                <div key={m.platillo_id} className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2">
                  <div>
                    <div className="font-medium text-slate-900">{m.comedor_platillos!.nombre}</div>
                    <div className="text-xs text-slate-500">
                      {m.comedor_platillos!.categoria ? `${m.comedor_platillos!.categoria} · ` : ""}
                      {m.comedor_platillos!.descripcion ?? ""}
                    </div>
                    <div className="text-sm tabular-nums text-slate-700">{moneda(Number(m.comedor_platillos!.precio))}</div>
                  </div>
                  {abierto && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setCantidades({ ...cantidades, [m.platillo_id]: Math.max(0, n - 1) })} className="h-8 w-8 rounded border border-slate-300 text-lg">
                        −
                      </button>
                      <span className="w-5 text-center tabular-nums">{n}</span>
                      <button type="button" onClick={() => setCantidades({ ...cantidades, [m.platillo_id]: n + 1 })} className="h-8 w-8 rounded border border-slate-300 text-lg">
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {abierto && platillos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota para la cocina (opcional)" className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="button" onClick={() => pedir.mutate()} disabled={pedir.isPending || total <= 0} className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {pedir.isPending ? "Enviando…" : `Pedir · ${moneda(total)}`}
          </button>
        </div>
      ) : (
        platillos.length > 0 && <p className="text-sm text-amber-700">Ya pasó la hora límite para pedir de este día.</p>
      )}
      {aviso && <p className="text-sm text-slate-700">{aviso}</p>}

      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Mis comidas del último mes</h3>
        <p className="mb-2 text-xs text-slate-500">Por descontar en tu próxima nómina: {moneda(porDescontar)}</p>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
          {misPedidos.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
              <span>
                {p.fecha} · {p.detalle || "—"}
              </span>
              <span className="tabular-nums text-slate-600">
                {moneda(Number(p.total))} · {p.estado === "cancelado" ? "cancelado" : p.descuento_aplicado_en ? "descontado" : p.estado === "entregado" ? "por descontar" : "por entregar"}
              </span>
            </li>
          ))}
          {misPedidos.length === 0 && <li className="px-3 py-2 text-slate-400">Todavía no has pedido.</li>}
        </ul>
      </div>
    </div>
  );
}
