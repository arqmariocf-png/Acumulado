import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { RUTA_RESPALDO_DEFAULT, revisarConexion, tamano, urlAutorizacion } from "../../lib/respaldoDropbox";

// Respaldo en Dropbox de los proyectos a cotizar (21-oct-2026, Mario: "la
// biblioteca de archivos en Dropbox… para que puedan leerse desde otras
// secciones de Claude"; "únicamente por ahora de los proyectos a cotizar").
// Se conecta una vez con una app de Dropbox; luego la edge `respaldo-dropbox`
// copia cada noche proyectos, planos, precios unitarios y cotizaciones (CSV +
// LEEME.md). Solo el director general.

interface Estado {
  conectado: boolean;
  cuenta: string | null;
  ruta: string;
}

interface Corrida {
  id: string;
  inicio: string;
  fin: string | null;
  origen: string;
  tablas: number;
  renglones: number;
  archivos: number;
  bytes: number;
  pendientes: number | null;
  errores: number;
  mensaje: string | null;
}

async function llamar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("respaldo-dropbox", { body });
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detalle?.error ?? error.message);
  }
  return data as T;
}

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function RespaldoDropbox() {
  const { esAdminGlobal } = useAuth();
  if (!esAdminGlobal) return <p className="p-8 text-center text-sm text-slate-500">Solo el director general maneja el respaldo en Dropbox.</p>;
  return <RespaldoDirector />;
}

function RespaldoDirector() {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const estado = useQuery({ queryKey: ["respaldo-dropbox", "estado"], queryFn: () => llamar<Estado>({ accion: "estado" }) });
  const corridas = useQuery({
    queryKey: ["respaldo-dropbox", "corridas"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [c, items] = await Promise.all([
        supabase.from("respaldos_dropbox").select("*").order("inicio", { ascending: false }).limit(15),
        supabase.from("respaldo_dropbox_items").select("tipo, bytes, copiado_en, error").limit(5000),
      ]);
      if (c.error) throw c.error;
      if (items.error) throw items.error;
      const lista = (items.data ?? []) as { tipo: string; bytes: number | null; copiado_en: string | null; error: string | null }[];
      const copiados = lista.filter((i) => i.copiado_en && !i.error);
      return {
        corridas: (c.data ?? []) as Corrida[],
        tablas: copiados.filter((i) => i.tipo === "tabla").length,
        archivos: copiados.filter((i) => i.tipo === "archivo").length,
        bytes: copiados.reduce((s, i) => s + (i.bytes ?? 0), 0),
        conError: lista.filter((i) => i.error).length,
      };
    },
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ["respaldo-dropbox"] });
  const respaldar = useMutation({
    mutationFn: () => llamar<{ segundos: number; tablas: number; cambiaron: number; archivos: number; pendientes: number; errores: number }>({ accion: "respaldar" }),
    onSuccess: (r) => {
      setAviso({
        tipo: r.errores ? "error" : "ok",
        texto: `Listo en ${r.segundos} s: ${r.tablas} tablas revisadas (${r.cambiaron} cambiaron), ${r.archivos} archivos copiados.${r.pendientes ? ` Faltan ${r.pendientes}; siguen solos cada hora.` : " Todo al día."}${r.errores ? ` ${r.errores} con error (ver abajo).` : ""}`,
      });
      refrescar();
    },
    onError: (e: Error) => setAviso({ tipo: "error", texto: e.message }),
  });
  const desconectar = useMutation({
    mutationFn: () => llamar({ accion: "desconectar" }),
    onSuccess: () => {
      setAviso({ tipo: "ok", texto: "Dropbox desconectado: el respaldo automático se detuvo. Lo ya copiado sigue en tu Dropbox." });
      refrescar();
    },
    onError: (e: Error) => setAviso({ tipo: "error", texto: e.message }),
  });

  if (estado.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (estado.error) return <p className="text-sm text-red-700">{(estado.error as Error).message}</p>;
  const e = estado.data!;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Respaldo en Dropbox</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Por ahora solo lo que sirve para <b>cotizar obras</b>: cada noche el sistema copia a tu Dropbox los proyectos, sus planos, el presupuesto del
          cliente, los precios unitarios (análisis, insumos, precios y factores) y las cotizaciones, en CSV con un <b>LEEME.md</b> que explica cada archivo.
          Desde cualquier conversación de Claude con el conector de Dropbox puedes pedir "lee el LEEME del respaldo de Acumulado y ayúdame a cotizar…".
        </p>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          No se copia nada más: ni bancos, facturas, órdenes de compra, inventario, RH, contraseñas ni llaves.
        </p>
      </div>

      {aviso && <p className={`rounded px-3 py-2 text-sm ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{aviso.texto}</p>}

      {e.conectado ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <span className="text-emerald-900">
            Conectado a <b>{e.cuenta}</b> · carpeta <b>{e.ruta}</b>
            <span className="block text-xs text-emerald-800">Si la app es de tipo "App folder", la carpeta está en Dropbox → Apps → (nombre de tu app){e.ruta}.</span>
          </span>
          <button onClick={() => respaldar.mutate()} disabled={respaldar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">
            {respaldar.isPending ? "Respaldando (hasta 2 min)…" : "Respaldar ahora"}
          </button>
          <button
            onClick={() => confirm("¿Desconectar Dropbox? El respaldo automático se detiene; lo ya copiado se queda en Dropbox.") && desconectar.mutate()}
            className="text-xs text-red-700 underline"
          >
            Desconectar
          </button>
        </div>
      ) : (
        <Conectar onListo={(texto) => { setAviso({ tipo: "ok", texto }); refrescar(); }} onError={(texto) => setAviso({ tipo: "error", texto })} />
      )}

      {corridas.data && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            En Dropbox: <b>{corridas.data.tablas}</b> tablas y <b>{corridas.data.archivos}</b> archivos ({tamano(corridas.data.bytes)})
            {corridas.data.conError ? <span className="text-red-700"> · {corridas.data.conError} con error, se reintentan solos</span> : null}.
            <span className="text-xs text-slate-500"> Corre cada hora al minuto 25; cada tabla se actualiza una vez al día.</span>
          </p>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Corrida</th>
                  <th className="px-3 py-2 text-right">Tablas</th>
                  <th className="px-3 py-2 text-right">Renglones</th>
                  <th className="px-3 py-2 text-right">Archivos</th>
                  <th className="px-3 py-2 text-right">Subido</th>
                  <th className="px-3 py-2 text-right">Faltan</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {corridas.data.corridas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-500">Todavía no hay respaldos.</td>
                  </tr>
                )}
                {corridas.data.corridas.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">
                      {fechaHora(c.inicio)} <span className="text-xs text-slate-500">{c.origen === "manual" ? "a mano" : "automático"}{c.fin ? "" : " · en curso o cortada"}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.tablas}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.renglones.toLocaleString("es-MX")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.archivos}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{tamano(c.bytes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.pendientes ?? "—"}</td>
                    <td className={`px-3 py-2 text-xs ${c.errores ? "text-red-700" : "text-slate-500"}`}>{c.mensaje ?? (c.errores ? `${c.errores} errores` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Conectar({ onListo, onError }: { onListo: (t: string) => void; onError: (t: string) => void }) {
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ruta, setRuta] = useState(RUTA_RESPALDO_DEFAULT);
  const conectar = useMutation({
    mutationFn: () => {
      const problema = revisarConexion(appKey, appSecret, codigo, ruta);
      if (problema) throw new Error(problema);
      return llamar<{ cuenta: string; ruta: string }>({ accion: "conectar", appKey, appSecret, codigo, ruta });
    },
    onSuccess: (r) => onListo(`Conectado a ${r.cuenta}. El primer respaldo corre en el siguiente minuto 25 o con "Respaldar ahora".`),
    onError: (e: Error) => onError(e.message),
  });
  const input = "mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <form
      data-sin-borrador
      autoComplete="off"
      onSubmit={(ev) => {
        ev.preventDefault();
        conectar.mutate();
      }}
      className="space-y-3 rounded border border-slate-200 bg-white p-4 text-sm"
    >
      <p className="font-medium text-slate-900">Conectar tu Dropbox (una sola vez, 5 minutos)</p>
      <ol className="list-decimal space-y-1 pl-5 text-slate-700">
        <li>
          Entra a{" "}
          <a href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noreferrer" className="text-sky-700 underline">
            dropbox.com/developers/apps/create
          </a>{" "}
          con tu cuenta: <b>Scoped access</b> → <b>App folder</b> (recomendado: la app solo puede tocar su propia carpeta) → nombre, por ejemplo "Acumulado
          respaldo" → <b>Create app</b>.
        </li>
        <li>
          En la pestaña <b>Permissions</b> marca <code>files.content.write</code> y <code>files.content.read</code> y da <b>Submit</b>.
        </li>
        <li>
          En <b>Settings</b> copia la <b>App key</b> y el <b>App secret</b> (botón "Show") y pégalos aquí.
        </li>
        <li>Da "Autorizar en Dropbox", acepta y copia el código que te muestra.</li>
      </ol>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">
          App key
          <input value={appKey} onChange={(e) => setAppKey(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-slate-600">
          App secret
          <input type="password" autoComplete="new-password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} className={input} />
        </label>
        <label className="text-xs text-slate-600">
          Carpeta en Dropbox
          <input value={ruta} onChange={(e) => setRuta(e.target.value)} className={input} />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            disabled={appKey.trim().length < 10}
            onClick={() => window.open(urlAutorizacion(appKey), "_blank", "noopener")}
            className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Autorizar en Dropbox
          </button>
        </div>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Código que te dio Dropbox
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} className={input} />
        </label>
      </div>
      <button disabled={conectar.isPending} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
        {conectar.isPending ? "Conectando…" : "Conectar"}
      </button>
      <p className="text-xs text-slate-500">La llave se guarda en la configuración interna del sistema (nadie la puede leer desde la app) y se usa solo para escribir el respaldo.</p>
    </form>
  );
}
