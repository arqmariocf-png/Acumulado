import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { porPreparar, type PedidoComedor } from "../../lib/comedor";
import { hoyMx, mensajeError, useConfigComedor } from "./comun";

interface Platillo {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  precio: number;
  activo: boolean;
}

/** Cocina: catálogo de platillos, menú del día y entregas. Solo lo
 * entregado se descuenta en nómina. */
export function Cocina() {
  const queryClient = useQueryClient();
  const { data: config } = useConfigComedor();
  const [fecha, setFecha] = useState(hoyMx());
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", categoria: "", descripcion: "", precio: "" });
  const [buscar, setBuscar] = useState("");

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["comedor"] });
  const falla = (e: unknown) => setAviso(mensajeError(e));

  const { data: platillos = [] } = useQuery({
    queryKey: ["comedor", "platillos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("comedor_platillos").select("id, nombre, descripcion, categoria, precio, activo").order("categoria").order("nombre");
      if (error) throw error;
      return (data ?? []) as Platillo[];
    },
  });
  const { data: menu = [] } = useQuery({
    queryKey: ["comedor", "menu", fecha],
    queryFn: async () => {
      const { data, error } = await supabase.from("comedor_menu").select("id, platillo_id, cupo").eq("fecha", fecha);
      if (error) throw error;
      return (data ?? []) as { id: string; platillo_id: string; cupo: number | null }[];
    },
  });
  const { data: pedidos = [] } = useQuery({
    queryKey: ["comedor", "pedidos-dia", fecha],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_comedor_pedidos").select("*").eq("fecha", fecha).order("trabajador_nombre");
      if (error) throw error;
      return (data ?? []) as PedidoComedor[];
    },
  });

  const agregarPlatillo = useMutation({
    mutationFn: async () => {
      const precio = Number(nuevo.precio);
      if (!nuevo.nombre.trim()) throw new Error("Escribe el nombre del platillo.");
      if (!(precio >= 0) || nuevo.precio === "") throw new Error("Escribe el precio.");
      const { error } = await supabase.from("comedor_platillos").insert({
        empresa_id: config!.empresa_id,
        nombre: nuevo.nombre.trim(),
        categoria: nuevo.categoria.trim() || null,
        descripcion: nuevo.descripcion.trim() || null,
        precio,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNuevo({ nombre: "", categoria: "", descripcion: "", precio: "" });
      setAviso("Platillo agregado.");
      refrescar();
    },
    onError: falla,
  });

  const editarPlatillo = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<Platillo> }) => {
      const { error } = await supabase.from("comedor_platillos").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: falla,
  });

  const alternarMenu = useMutation({
    mutationFn: async (platilloId: string) => {
      const existe = menu.find((m) => m.platillo_id === platilloId);
      if (existe) {
        const { error } = await supabase.from("comedor_menu").delete().eq("id", existe.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("comedor_menu").insert({ empresa_id: config!.empresa_id, fecha, platillo_id: platilloId });
        if (error) throw error;
      }
    },
    onSuccess: refrescar,
    onError: falla,
  });

  const copiarAyer = useMutation({
    mutationFn: async () => {
      const ayer = new Date(`${fecha}T12:00:00Z`);
      ayer.setUTCDate(ayer.getUTCDate() - 1);
      const { data, error } = await supabase.from("comedor_menu").select("platillo_id, cupo").eq("fecha", ayer.toISOString().slice(0, 10));
      if (error) throw error;
      const nuevos = (data ?? []).filter((m) => !menu.some((x) => x.platillo_id === m.platillo_id));
      if (nuevos.length === 0) throw new Error("No hay nada nuevo que copiar del día anterior.");
      const { error: e2 } = await supabase.from("comedor_menu").insert(nuevos.map((m) => ({ empresa_id: config!.empresa_id, fecha, platillo_id: m.platillo_id, cupo: m.cupo })));
      if (e2) throw e2;
    },
    onSuccess: () => {
      setAviso("Menú copiado del día anterior.");
      refrescar();
    },
    onError: falla,
  });

  const cupo = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: number | null }) => {
      const { error } = await supabase.from("comedor_menu").update({ cupo: valor }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: falla,
  });

  const entregar = useMutation({
    mutationFn: async ({ id, entregado }: { id: string; entregado: boolean }) => {
      const { error } = await supabase.rpc("fn_comedor_entregar", { p_pedido: id, p_entregado: entregado });
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: falla,
  });

  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("¿Cancelar este pedido?")) return;
      const { error } = await supabase.rpc("fn_comedor_cancelar", { p_pedido: id });
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: falla,
  });

  const guardarHora = useMutation({
    mutationFn: async (hora: string) => {
      const { error } = await supabase.from("comedor_config").update({ hora_limite: hora, updated_at: new Date().toISOString() }).eq("grupo_id", config!.grupo_id);
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Hora límite actualizada.");
      refrescar();
    },
    onError: falla,
  });

  if (!config) return <p className="text-sm text-slate-500">El comedor no está configurado.</p>;

  const activos = pedidos.filter((p) => p.estado !== "cancelado");
  const entregados = activos.filter((p) => p.estado === "entregado");
  const preparar = porPreparar(pedidos);
  const q = buscar.trim().toLowerCase();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Día
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          Hora límite para pedir
          <input type="time" defaultValue={config.hora_limite.slice(0, 5)} onBlur={(e) => e.target.value && e.target.value !== config.hora_limite.slice(0, 5) && guardarHora.mutate(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        {aviso && <span className="text-slate-600">{aviso}</span>}
      </div>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">
          Pedidos del {fecha}: {activos.length} · entregados {entregados.length} · {moneda(activos.reduce((s, p) => s + Number(p.total), 0))}
        </h3>
        {preparar.length > 0 && (
          <p className="mb-2 text-xs text-slate-600">
            Por preparar: {preparar.map((x) => `${x.piezas} ${x.platillo}`).join(" · ")}
          </p>
        )}
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar trabajador…" className="mb-2 w-full max-w-xs rounded border border-slate-300 px-2 py-1 text-sm" />
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
          {pedidos
            .filter((p) => !q || (p.trabajador_nombre ?? "").toLowerCase().includes(q))
            .map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${p.estado === "cancelado" ? "text-slate-400 line-through" : ""}`}>
                <span className="font-medium">{p.trabajador_nombre}</span>
                <span className="text-xs text-slate-500">{p.empresa_trabajador}</span>
                <span className="text-slate-700">{p.detalle}</span>
                <span className="ml-auto tabular-nums">{moneda(Number(p.total))}</span>
                {p.estado === "pedido" && (
                  <>
                    <button type="button" onClick={() => entregar.mutate({ id: p.id, entregado: true })} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
                      Entregado
                    </button>
                    <button type="button" onClick={() => cancelar.mutate(p.id)} className="text-xs text-red-700 underline">
                      cancelar
                    </button>
                  </>
                )}
                {p.estado === "entregado" && !p.descuento_aplicado_en && (
                  <button type="button" onClick={() => entregar.mutate({ id: p.id, entregado: false })} className="text-xs text-slate-500 underline">
                    deshacer entrega
                  </button>
                )}
                {p.descuento_aplicado_en && <span className="text-xs text-slate-500">descontado</span>}
              </li>
            ))}
          {pedidos.length === 0 && <li className="px-3 py-2 text-slate-400">Sin pedidos para este día.</li>}
        </ul>
      </section>

      <section>
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Menú del {fecha}</h3>
          <button type="button" onClick={() => copiarAyer.mutate()} className="text-xs text-slate-600 underline">
            copiar el menú del día anterior
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">Marca los platillos que se ofrecen ese día. El cupo es opcional: al llenarse ya no se aceptan pedidos de ese platillo.</p>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
          {platillos.map((pl) => {
            const enMenu = menu.find((m) => m.platillo_id === pl.id);
            return (
              <li key={pl.id} className={`flex flex-wrap items-center gap-2 px-3 py-1.5 ${pl.activo ? "" : "opacity-50"}`}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!enMenu} disabled={!pl.activo} onChange={() => alternarMenu.mutate(pl.id)} />
                  <span className="font-medium">{pl.nombre}</span>
                </label>
                <span className="text-xs text-slate-500">{pl.categoria ?? ""}</span>
                <span className="tabular-nums">
                  $
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    defaultValue={pl.precio}
                    onBlur={(e) => Number(e.target.value) !== Number(pl.precio) && editarPlatillo.mutate({ id: pl.id, cambios: { precio: Number(e.target.value) } })}
                    className="ml-1 w-20 rounded border border-slate-200 px-1 py-0.5 text-right"
                    aria-label="Precio"
                  />
                </span>
                {enMenu && (
                  <span className="text-xs">
                    cupo
                    <input
                      type="number"
                      min="1"
                      defaultValue={enMenu.cupo ?? ""}
                      onBlur={(e) => cupo.mutate({ id: enMenu.id, valor: e.target.value ? Number(e.target.value) : null })}
                      className="ml-1 w-16 rounded border border-slate-200 px-1 py-0.5 text-right"
                      aria-label="Cupo"
                    />
                  </span>
                )}
                <button type="button" onClick={() => editarPlatillo.mutate({ id: pl.id, cambios: { activo: !pl.activo } })} className="ml-auto text-xs text-slate-500 underline">
                  {pl.activo ? "desactivar" : "activar"}
                </button>
              </li>
            );
          })}
          {platillos.length === 0 && <li className="px-3 py-2 text-slate-400">Agrega tu primer platillo abajo.</li>}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            agregarPlatillo.mutate();
          }}
          className="mt-2 flex flex-wrap items-center gap-2 text-sm"
        >
          <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Platillo nuevo" className="rounded border border-slate-300 px-2 py-1" />
          <input value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} placeholder="Categoría (comida, bebida…)" className="rounded border border-slate-300 px-2 py-1" />
          <input value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} placeholder="Descripción" className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1" />
          <input type="number" min="0" step="0.5" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} placeholder="Precio" className="w-24 rounded border border-slate-300 px-2 py-1" />
          <button type="submit" disabled={agregarPlatillo.isPending} className="rounded bg-slate-900 px-3 py-1 font-medium text-white disabled:opacity-50">
            Agregar
          </button>
        </form>
      </section>
    </div>
  );
}
