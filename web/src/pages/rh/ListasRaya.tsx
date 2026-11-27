import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { esRh } from "../../lib/modulos";
import { CampoBuscador } from "../../components/CampoBuscador";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { logoDeEmpresa } from "../../lib/logoEmpresaCargar";
import { descargarCsv } from "../../lib/descargarArchivo";
import {
  ESTADOS,
  avanceConLista,
  avancePresupuesto,
  csvLista,
  domingoDe,
  filtrarPorTexto,
  htmlListaRaya,
  numeroSemana,
  revisarLista,
  revisarRenglon,
  sumarDias,
  textoSemana,
  totalesLista,
  type AvancePartida,
  type EstadoLista,
  type FormaPago,
  type RenglonLista,
  type TipoTrabajador,
} from "../../lib/manoObra";

// Listas de raya de mano de obra (27-nov-2026, Laura: "dejar de trabajar en
// dos sistemas"). RH captura la lista de cada obra y semana, dirección la
// autoriza y se vuelve pago programado (tipo mano de obra). Convive con el
// backoffice: lo que se autoriza aquí reemplaza, para esa obra y semana, lo
// que manda la API en los reportes (avance financiero, gasto de obra, RH).

interface Obra { id: string; nombre: string; empresa_id: string; empresa: string; empresa_codigo: string; activo: boolean }
interface Lista {
  id: string; empresa_id: string; proyecto_id: string; folio: string | null; semana_inicio: string; semana_fin: string; num_sem: number;
  estado: EstadoLista; notas: string | null; capturo_nombre: string | null; enviada_en: string | null; autorizada_nombre: string | null;
  autorizada_en: string | null; rechazo_motivo: string | null; fecha_pago: string | null; pagos: string[];
}
interface Renglon extends RenglonLista { id: string; lista_id: string; orden: number }
interface Trabajador { id: string; nombre: string; tipo: TipoTrabajador; puesto: string | null; empresa_id: string | null; backoffice_id: number | null; forma_pago: FormaPago; banco: string | null; clabe: string | null; notas: string | null; activo: boolean }
interface Cuenta { id: string; banco: string; ultimos_4: string | null }

const dinero = (x: number | null | undefined) => (x == null ? "—" : `$${Number(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hoyMx = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const errorTexto = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : String(e));

function useObras() {
  return useQuery({
    queryKey: ["mo-obras"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mo_obras");
      if (error) throw error;
      return (data ?? []) as Obra[];
    },
  });
}
function useTrabajadores() {
  return useQuery({
    queryKey: ["mo-trabajadores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mo_trabajadores").select("*").order("nombre");
      if (error) throw error;
      return (data ?? []) as Trabajador[];
    },
  });
}
function useCatalogo() {
  return useQuery({
    queryKey: ["mo-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mo_catalogo");
      if (error) throw error;
      return ((data as { partidas?: { partida: string; subpartida: string | null; veces: number }[] } | null)?.partidas ?? []);
    },
  });
}

export function ListasRaya() {
  const { perfil, soloConsulta } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "listas";
  const listaId = params.get("lista");
  const puedeCapturar = !soloConsulta && (esRh(perfil) || perfil?.rol === "admin");
  const puedeAutorizar = !soloConsulta && (perfil?.rol === "direccion" || perfil?.rol === "admin");
  const ir = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) {
      if (v == null) n.delete(k);
      else n.set(k, v);
    }
    setParams(n);
  };

  const pestañas: [string, string][] = [
    ["listas", "Listas de raya"],
    ["autorizar", "Por autorizar"],
    ["presupuesto", "Presupuesto por partida"],
    ["trabajadores", "Trabajadores"],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Mano de obra · listas de raya</h1>
          <p className="text-sm text-slate-600">RH captura la lista de cada obra y semana (domingo a sábado), dirección la autoriza y queda programada a pago. Lo autorizado aquí sustituye, para esa obra y semana, lo que manda el backoffice.</p>
        </div>
        <Link to="/rh/mano-de-obra" className="text-sm text-indigo-700 underline">Pagos que manda el backoffice</Link>
      </header>
      {!listaId && (
        <nav className="flex flex-wrap gap-1 border-b border-slate-200">
          {pestañas.map(([k, t]) => (
            <button key={k} onClick={() => ir({ tab: k })} className={`rounded-t px-3 py-2 text-sm ${tab === k ? "border border-b-white border-slate-200 bg-white font-medium" : "text-slate-600"}`}>{t}</button>
          ))}
        </nav>
      )}
      {listaId ? (
        <DetalleLista id={listaId} puedeCapturar={puedeCapturar} puedeAutorizar={puedeAutorizar} cerrar={() => ir({ lista: null })} abrir={(id) => ir({ lista: id })} />
      ) : tab === "autorizar" ? (
        <TablaListas modo="autorizar" puedeCapturar={puedeCapturar} abrir={(id) => ir({ lista: id })} />
      ) : tab === "presupuesto" ? (
        <Presupuesto />
      ) : tab === "trabajadores" ? (
        <Trabajadores puedeEditar={puedeCapturar || puedeAutorizar} />
      ) : (
        <TablaListas modo="semana" puedeCapturar={puedeCapturar} abrir={(id) => ir({ lista: id })} />
      )}
    </div>
  );
}

function TablaListas({ modo, puedeCapturar, abrir }: { modo: "semana" | "autorizar"; puedeCapturar: boolean; abrir: (id: string) => void }) {
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [semana, setSemana] = useState(domingoDe(hoyMx()));
  const [pendientes, setPendientes] = useState(false);
  const [nueva, setNueva] = useState(false);
  const obras = useObras();
  const obraDe = useMemo(() => new Map((obras.data ?? []).map((o) => [o.id, o])), [obras.data]);

  const listas = useQuery({
    queryKey: ["mo-listas", modo, semana, pendientes, empresa],
    queryFn: async () => {
      let q = supabase.from("mo_listas").select("*").order("semana_inicio", { ascending: false }).order("folio", { ascending: false });
      if (modo === "autorizar") q = q.eq("estado", "enviada");
      else if (pendientes) q = q.in("estado", ["borrador", "enviada", "rechazada"]);
      else q = q.eq("semana_inicio", semana);
      if (empresa) q = q.eq("empresa_id", empresa);
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      const ls = (data ?? []) as Lista[];
      const totales = new Map<string, { total: number; n: number }>();
      for (let i = 0; i < ls.length; i += 200) {
        const { data: rs, error: e2 } = await supabase.from("mo_lista_renglones").select("lista_id, monto").in("lista_id", ls.slice(i, i + 200).map((l) => l.id));
        if (e2) throw e2;
        for (const r of rs ?? []) {
          const t = totales.get(r.lista_id) ?? { total: 0, n: 0 };
          t.total += Number(r.monto);
          t.n += 1;
          totales.set(r.lista_id, t);
        }
      }
      return ls.map((l) => ({ ...l, total: totales.get(l.id)?.total ?? 0, renglones: totales.get(l.id)?.n ?? 0 }));
    },
  });
  const suma = (listas.data ?? []).filter((l) => l.estado !== "cancelada").reduce((s, l) => s + l.total, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorEmpresa value={empresa} onChange={setEmpresa} />
        {modo === "semana" && (
          <>
            <button className="rounded border px-2 py-1 text-sm" onClick={() => setSemana(sumarDias(semana, -7))} disabled={pendientes}>←</button>
            <input type="date" className="rounded border px-2 py-1 text-sm" value={semana} disabled={pendientes} onChange={(e) => e.target.value && setSemana(domingoDe(e.target.value))} />
            <button className="rounded border px-2 py-1 text-sm" onClick={() => setSemana(sumarDias(semana, 7))} disabled={pendientes}>→</button>
            <span className="text-sm text-slate-600">{pendientes ? "Todas las semanas" : textoSemana(semana)}</span>
            <label className="ml-2 flex items-center gap-1 text-sm"><input type="checkbox" checked={pendientes} onChange={(e) => setPendientes(e.target.checked)} /> solo pendientes de cualquier semana</label>
            {puedeCapturar && <button className="ml-auto rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={() => setNueva(!nueva)}>+ Nueva lista de raya</button>}
          </>
        )}
      </div>
      {nueva && <NuevaLista semanaInicial={semana} obras={obras.data ?? []} empresa={empresa} cerrar={() => setNueva(false)} abrir={abrir} />}
      {listas.error && <p className="text-sm text-rose-700">{errorTexto(listas.error)}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-2">Folio</th><th className="p-2">Obra</th><th className="p-2">Semana</th><th className="p-2">Estado</th><th className="p-2 text-right">Renglones</th><th className="p-2 text-right">Total</th><th className="p-2">Capturó</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {(listas.data ?? []).map((l) => {
              const o = obraDe.get(l.proyecto_id);
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="p-2 font-mono text-xs">{l.folio}</td>
                  <td className="p-2">{o?.nombre ?? "—"}<div className="text-xs text-slate-500">{o?.empresa_codigo}</div></td>
                  <td className="p-2 whitespace-nowrap">Sem {l.num_sem}<div className="text-xs text-slate-500">{l.semana_inicio.slice(8)}/{l.semana_inicio.slice(5, 7)} al {l.semana_fin.slice(8)}/{l.semana_fin.slice(5, 7)}</div></td>
                  <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-xs ${ESTADOS[l.estado].clase}`}>{ESTADOS[l.estado].etiqueta}</span>{l.rechazo_motivo && l.estado === "rechazada" && <div className="text-xs text-rose-700">{l.rechazo_motivo}</div>}</td>
                  <td className="p-2 text-right">{l.renglones}</td>
                  <td className="p-2 text-right font-medium">{dinero(l.total)}</td>
                  <td className="p-2 text-xs text-slate-600">{l.capturo_nombre}</td>
                  <td className="p-2 text-right"><button className="text-indigo-700 underline" onClick={() => abrir(l.id)}>{modo === "autorizar" ? "Revisar" : "Abrir"}</button></td>
                </tr>
              );
            })}
            {!listas.isLoading && !(listas.data ?? []).length && (
              <tr><td colSpan={8} className="p-4 text-center text-slate-500">{modo === "autorizar" ? "No hay listas por autorizar." : "No hay listas de raya en esta semana."}</td></tr>
            )}
          </tbody>
          {(listas.data ?? []).length > 0 && (
            <tfoot><tr className="border-t bg-slate-50 font-medium"><td colSpan={5} className="p-2">{listas.data?.length} listas</td><td className="p-2 text-right">{dinero(suma)}</td><td colSpan={2} /></tr></tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function NuevaLista({ semanaInicial, obras, empresa, cerrar, abrir }: { semanaInicial: string; obras: Obra[]; empresa: string; cerrar: () => void; abrir: (id: string) => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [obraId, setObraId] = useState("");
  const [semana, setSemana] = useState(semanaInicial);
  const [error, setError] = useState("");
  const opciones = obras.filter((o) => o.activo && (!empresa || o.empresa_id === empresa)).map((o) => ({ clave: o.id, titulo: o.nombre, detalle: o.empresa_codigo }));
  async function crear() {
    setError("");
    if (!obraId) return setError("Elige la obra.");
    const { data, error: e } = await supabase.from("mo_listas").insert({ proyecto_id: obraId, empresa_id: obras.find((o) => o.id === obraId)?.empresa_id, semana_inicio: semana }).select("id").single();
    if (e) return setError(e.message.includes("mo_listas_obra_semana") ? "Esa obra ya tiene lista de raya para esa semana." : e.message);
    await qc.invalidateQueries({ queryKey: ["mo-listas"] });
    cerrar();
    abrir(data.id);
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-indigo-200 bg-indigo-50 p-3">
      <label className="min-w-72 flex-1 text-sm">Obra
        <CampoBuscador value={texto} onChange={(t) => { setTexto(t); setObraId(""); }} opciones={opciones} onElegir={(id) => { setObraId(id); setTexto(obras.find((o) => o.id === id)?.nombre ?? ""); }} placeholder="Busca la obra…" className="w-full rounded border px-2 py-1.5" vacio="No hay obras activas con ese nombre" autoFocus />
      </label>
      <label className="text-sm">Semana (cualquier día)
        <input type="date" className="block rounded border px-2 py-1.5" value={semana} onChange={(e) => e.target.value && setSemana(domingoDe(e.target.value))} />
      </label>
      <span className="pb-2 text-xs text-slate-600">{textoSemana(semana)}</span>
      <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={crear}>Crear lista</button>
      <button className="rounded border px-3 py-1.5 text-sm" onClick={cerrar}>Cancelar</button>
      {error && <p className="w-full text-sm text-rose-700">{error}</p>}
    </div>
  );
}

const renglonVacio = (): RenglonLista => ({ trabajador_id: null, trabajador_nombre: "", tipo_trabajador: "empleado", partida: "", subpartida: "", dias: "", monto: "", forma_pago: "transferencia" });

function DetalleLista({ id, puedeCapturar, puedeAutorizar, cerrar, abrir }: { id: string; puedeCapturar: boolean; puedeAutorizar: boolean; cerrar: () => void; abrir: (id: string) => void }) {
  const qc = useQueryClient();
  const obras = useObras();
  const trabajadores = useTrabajadores();
  const catalogo = useCatalogo();
  const [nuevo, setNuevo] = useState<RenglonLista>(renglonVacio());
  const [textoPartida, setTextoPartida] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [copiarA, setCopiarA] = useState("");

  const datos = useQuery({
    queryKey: ["mo-lista", id],
    queryFn: async () => {
      const [l, r] = await Promise.all([
        supabase.from("mo_listas").select("*").eq("id", id).single(),
        supabase.from("mo_lista_renglones").select("*").eq("lista_id", id).order("orden").order("created_at"),
      ]);
      if (l.error) throw l.error;
      if (r.error) throw r.error;
      return { lista: l.data as Lista, renglones: (r.data ?? []) as Renglon[] };
    },
  });
  const lista = datos.data?.lista;
  const renglones = useMemo(() => datos.data?.renglones ?? [], [datos.data]);
  const obra = obras.data?.find((o) => o.id === lista?.proyecto_id);
  const editable = puedeCapturar && !!lista && (lista.estado === "borrador" || lista.estado === "rechazada");

  const avance = useQuery({
    queryKey: ["mo-avance", lista?.proyecto_id],
    enabled: !!lista,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mo_presupuesto_avance", { p_proyecto: lista!.proyecto_id });
      if (error) throw error;
      return (data ?? []) as AvancePartida[];
    },
  });
  const cuentas = useQuery({
    queryKey: ["mo-cuentas", lista?.empresa_id],
    enabled: !!lista && puedeAutorizar && lista.estado === "enviada",
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4").eq("empresa_id", lista!.empresa_id);
      if (error) throw error;
      return (data ?? []) as Cuenta[];
    },
  });

  const recargar = () => Promise.all([qc.invalidateQueries({ queryKey: ["mo-lista", id] }), qc.invalidateQueries({ queryKey: ["mo-listas"] }), qc.invalidateQueries({ queryKey: ["mo-avance"] })]);
  async function correr(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setMensaje(null);
    const { error } = await fn();
    if (error) return setMensaje({ ok: false, texto: error.message });
    setMensaje({ ok: true, texto: ok });
    await recargar();
  }

  if (datos.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (!lista) return <p className="text-sm text-rose-700">No se encontró la lista o no tienes acceso. <button className="underline" onClick={cerrar}>Regresar</button></p>;

  const t = totalesLista(renglones);
  const revision = revisarLista(renglones);
  // Lo de esta lista solo se suma al avance si todavía no está autorizada (si ya, el avance ya lo trae).
  const filasAvance = avanceConLista(avance.data ?? [], lista.estado === "autorizada" ? [] : renglones);
  const opcionesTrab = filtrarPorTexto((trabajadores.data ?? []).filter((x) => x.activo), nuevo.trabajador_nombre, (x) => [x.nombre, x.puesto]).slice(0, 30).map((x) => ({ clave: x.id, titulo: x.nombre, detalle: [x.tipo === "contratista" ? "contratista" : "empleado", x.puesto].filter(Boolean).join(" · ") }));
  const partidasUnicas = [...new Map((catalogo.data ?? []).map((p) => [`${p.partida}|${p.subpartida ?? ""}`, p])).values()];
  const opcionesPartida = filtrarPorTexto(partidasUnicas, textoPartida, (p) => [p.partida, p.subpartida]).slice(0, 30).map((p) => ({ clave: `${p.partida}|${p.subpartida ?? ""}`, titulo: p.partida, detalle: p.subpartida ?? undefined }));

  async function agregar() {
    const errores = revisarRenglon(nuevo);
    if (errores.length) return setMensaje({ ok: false, texto: errores.join(" ") });
    await correr(
      () => supabase.from("mo_lista_renglones").insert({
        lista_id: id, empresa_id: lista!.empresa_id, trabajador_id: nuevo.trabajador_id, trabajador_nombre: nuevo.trabajador_nombre.trim(),
        tipo_trabajador: nuevo.tipo_trabajador, partida: nuevo.partida.trim(), subpartida: (nuevo.subpartida ?? "").trim() || null,
        dias: nuevo.dias === "" || nuevo.dias == null ? null : Number(nuevo.dias), monto: Number(nuevo.monto), forma_pago: nuevo.forma_pago, orden: renglones.length + 1,
      }),
      "Renglón agregado.",
    );
    setNuevo({ ...renglonVacio(), partida: nuevo.partida, subpartida: nuevo.subpartida, forma_pago: nuevo.forma_pago, dias: nuevo.dias });
  }
  async function imprimir() {
    const v = abrirVentanaImpresion();
    const logo = await logoDeEmpresa(obra?.empresa_codigo);
    abrirParaImprimir(htmlListaRaya(datosImpresion(), renglones, logo), v);
  }
  const datosImpresion = () => ({ folio: lista.folio, obra: obra?.nombre ?? "", empresa: obra?.empresa ?? "", semana_inicio: lista.semana_inicio, estado: lista.estado, capturo: lista.capturo_nombre, autorizo: lista.autorizada_nombre, fecha_pago: lista.fecha_pago, notas: lista.notas });

  return (
    <section className="space-y-4">
      <button className="text-sm text-indigo-700 underline" onClick={cerrar}>← Regresar a las listas</button>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded border border-slate-200 bg-white p-3">
        <div>
          <h2 className="text-lg font-semibold">Lista de raya {lista.folio} <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${ESTADOS[lista.estado].clase}`}>{ESTADOS[lista.estado].etiqueta}</span></h2>
          <p className="text-sm text-slate-700">{obra?.nombre} · {obra?.empresa}</p>
          <p className="text-sm text-slate-600">{textoSemana(lista.semana_inicio)}</p>
          <p className="text-xs text-slate-500">Capturó {lista.capturo_nombre ?? "—"}{lista.autorizada_nombre ? ` · autorizó ${lista.autorizada_nombre}` : ""}{lista.fecha_pago ? ` · pago ${lista.fecha_pago.split("-").reverse().join("/")}` : ""}</p>
          {lista.rechazo_motivo && <p className="mt-1 text-sm text-rose-700">Motivo: {lista.rechazo_motivo}</p>}
          {lista.estado === "autorizada" && <p className="mt-1 text-sm"><Link className="text-indigo-700 underline" to="/finanzas/pagos">Ver en Programación de pagos</Link></p>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold">{dinero(t.total)}</div>
          <div className="text-xs text-slate-600">Transferencia {dinero(t.transferencia)} · Efectivo {dinero(t.efectivo)}</div>
          <div className="text-xs text-slate-600">{t.trabajadores} trabajadores · {t.renglones} renglones</div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button className="rounded border px-2 py-1 text-sm" onClick={imprimir}>Imprimir</button>
            <button className="rounded border px-2 py-1 text-sm" onClick={() => descargarCsv(`Lista de raya ${lista.folio}.csv`, csvLista(datosImpresion(), renglones))}>Excel</button>
          </div>
        </div>
      </div>

      {mensaje && <p className={`rounded p-2 text-sm ${mensaje.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{mensaje.texto}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="p-2">#</th><th className="p-2">Trabajador</th><th className="p-2">Partida</th><th className="p-2">Subpartida</th><th className="p-2 text-right">Días</th><th className="p-2">Forma</th><th className="p-2 text-right">Monto</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {renglones.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 text-slate-500">{i + 1}</td>
                <td className="p-2">{r.trabajador_nombre}<div className="text-xs text-slate-500">{r.tipo_trabajador === "contratista" ? "Contratista" : "Empleado"}</div></td>
                <td className="p-2">{r.partida}</td>
                <td className="p-2">{r.subpartida}</td>
                <td className="p-2 text-right">{r.dias ?? ""}</td>
                <td className="p-2">{r.forma_pago === "efectivo" ? "Efectivo" : "Transferencia"}</td>
                <td className="p-2 text-right">{dinero(Number(r.monto))}</td>
                <td className="p-2 text-right">{editable && <button className="text-xs text-rose-700 underline" onClick={() => correr(() => supabase.from("mo_lista_renglones").delete().eq("id", r.id), "Renglón quitado.")}>quitar</button>}</td>
              </tr>
            ))}
            {!renglones.length && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Sin renglones todavía.</td></tr>}
          </tbody>
        </table>
        {editable && (
          <div className="grid gap-2 border-t border-slate-200 bg-slate-50 p-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <CampoBuscador value={nuevo.trabajador_nombre} onChange={(v) => setNuevo({ ...nuevo, trabajador_nombre: v, trabajador_id: null })} opciones={opcionesTrab} placeholder="Trabajador (nombre o de la lista)"
                onElegir={(tid) => { const x = trabajadores.data?.find((w) => w.id === tid); if (x) setNuevo({ ...nuevo, trabajador_id: x.id, trabajador_nombre: x.nombre, tipo_trabajador: x.tipo, forma_pago: x.forma_pago }); }} className="w-full rounded border px-2 py-1.5 text-sm" />
              <select className="mt-1 w-full rounded border px-2 py-1 text-xs" value={nuevo.tipo_trabajador} onChange={(e) => setNuevo({ ...nuevo, tipo_trabajador: e.target.value as TipoTrabajador })}><option value="empleado">Empleado</option><option value="contratista">Contratista</option></select>
            </div>
            <div className="md:col-span-3">
              <CampoBuscador value={textoPartida || nuevo.partida} onChange={(v) => { setTextoPartida(v); setNuevo({ ...nuevo, partida: v }); }} opciones={opcionesPartida} placeholder="Partida"
                onElegir={(k) => { const [p, s] = k.split("|"); setTextoPartida(""); setNuevo({ ...nuevo, partida: p, subpartida: s || nuevo.subpartida }); }} className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>
            <input className="rounded border px-2 py-1.5 text-sm md:col-span-2" placeholder="Subpartida / puesto" value={nuevo.subpartida ?? ""} onChange={(e) => setNuevo({ ...nuevo, subpartida: e.target.value })} />
            <input className="rounded border px-2 py-1.5 text-sm md:col-span-1" placeholder="Días" inputMode="decimal" value={nuevo.dias ?? ""} onChange={(e) => setNuevo({ ...nuevo, dias: e.target.value })} />
            <input className="rounded border px-2 py-1.5 text-sm md:col-span-1" placeholder="Monto" inputMode="decimal" value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
            <select className="rounded border px-2 py-1.5 text-sm md:col-span-1" value={nuevo.forma_pago} onChange={(e) => setNuevo({ ...nuevo, forma_pago: e.target.value as FormaPago })}><option value="transferencia">Transf.</option><option value="efectivo">Efectivo</option></select>
            <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white md:col-span-1" onClick={agregar}>Agregar</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={!revision.puede}
            onClick={() => correr(() => supabase.rpc("fn_mo_lista_enviar", { p_lista: id }), "Enviada a dirección para autorizar.")}>Enviar a autorizar</button>
        )}
        {puedeCapturar && ["borrador", "rechazada", "enviada"].includes(lista.estado) && (
          <button className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700" onClick={() => window.confirm("¿Cancelar esta lista de raya?") && correr(() => supabase.from("mo_listas").update({ estado: "cancelada" }).eq("id", id), "Lista cancelada.")}>Cancelar lista</button>
        )}
        {puedeCapturar && (
          <span className="flex items-center gap-1 text-sm">
            <input type="date" className="rounded border px-2 py-1" value={copiarA} onChange={(e) => setCopiarA(e.target.value ? domingoDe(e.target.value) : "")} />
            <button className="rounded border px-2 py-1 disabled:opacity-50" disabled={!copiarA} onClick={async () => {
              const { data, error } = await supabase.rpc("fn_mo_lista_copiar", { p_lista: id, p_semana_inicio: copiarA });
              if (error) return setMensaje({ ok: false, texto: error.message });
              await qc.invalidateQueries({ queryKey: ["mo-listas"] });
              abrir(data as string);
            }}>Copiar a la semana {copiarA ? numeroSemana(copiarA) : "…"}</button>
          </span>
        )}
      </div>
      {revision.avisos.length > 0 && editable && <p className="text-xs text-amber-700">{revision.avisos.join(" ")}</p>}

      {puedeAutorizar && lista.estado === "enviada" && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h3 className="font-medium">Autorizar lista de raya</h3>
          <p className="text-sm text-slate-700">Al autorizar se crean los pagos programados de mano de obra: uno por transferencia ({dinero(t.transferencia)}) y uno en efectivo ({dinero(t.efectivo)}) si los hay.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">Fecha de pago<input type="date" className="block rounded border px-2 py-1" value={fechaPago || lista.semana_fin} onChange={(e) => setFechaPago(e.target.value)} /></label>
            {t.transferencia > 0 && (
              <label className="text-sm">Cuenta de cargo (transferencia)
                <select className="block rounded border px-2 py-1" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                  <option value="">Por definir</option>
                  {(cuentas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.banco} {c.ultimos_4}</option>)}
                </select>
              </label>
            )}
            <button className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white" onClick={() => correr(() => supabase.rpc("fn_mo_lista_autorizar", { p_lista: id, p_autorizar: true, p_motivo: null, p_fecha_pago: fechaPago || lista.semana_fin, p_cuenta: cuenta || null }), "Autorizada: ya está en Programación de pagos.")}>Autorizar y programar pago</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input className="min-w-64 flex-1 rounded border px-2 py-1 text-sm" placeholder="Motivo del rechazo (lo ve RH)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700" onClick={() => correr(() => supabase.rpc("fn_mo_lista_autorizar", { p_lista: id, p_autorizar: false, p_motivo: motivo }), "Rechazada; RH recibió el aviso.")}>Rechazar</button>
          </div>
        </div>
      )}
      {puedeAutorizar && lista.estado === "autorizada" && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-3">
          <input className="min-w-64 flex-1 rounded border px-2 py-1 text-sm" placeholder="Motivo para reabrir (cancela los pagos pendientes de esta lista)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="rounded border px-3 py-1.5 text-sm" onClick={() => correr(() => supabase.rpc("fn_mo_lista_reabrir", { p_lista: id, p_motivo: motivo }), "Reabierta: regresó a RH para corregir.")}>Reabrir</button>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white p-3">
        <h3 className="mb-2 font-medium">Presupuesto de mano de obra de la obra {lista.estado !== "autorizada" && <span className="text-xs font-normal text-slate-500">(incluye lo de esta lista)</span>}</h3>
        <TablaAvance filas={filasAvance} />
      </div>
    </section>
  );
}

const COLOR_ESTADO = { sin_presupuesto: "text-slate-500", en_linea: "text-emerald-700", por_agotarse: "text-amber-700", excedido: "text-rose-700 font-semibold" } as const;
const TEXTO_ESTADO = { sin_presupuesto: "sin presupuesto", en_linea: "en línea", por_agotarse: "por agotarse", excedido: "excedido" } as const;

function TablaAvance({ filas, editar }: { filas: AvancePartida[]; editar?: (f: AvancePartida) => void }) {
  if (!filas.length) return <p className="text-sm text-slate-500">Sin pagos ni presupuesto en esta obra.</p>;
  const tot = filas.reduce((s, f) => ({ p: s.p + Number(f.presupuesto ?? 0), e: s.e + Number(f.ejercido ?? 0) + Number(f.conLista ?? 0) }), { p: 0, e: 0 });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr><th className="p-1">Partida</th><th className="p-1">Subpartida</th><th className="p-1 text-right">Presupuesto</th><th className="p-1 text-right">Pagado</th><th className="p-1 text-right">Esta lista</th><th className="p-1 text-right">Restante</th><th className="p-1">%</th><th /></tr></thead>
        <tbody>
          {filas.map((f, i) => {
            const a = avancePresupuesto(f);
            return (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-1">{f.partida}</td><td className="p-1 text-slate-600">{f.subpartida}</td>
                <td className="p-1 text-right">{dinero(f.presupuesto)}</td><td className="p-1 text-right">{dinero(Number(f.ejercido))}</td>
                <td className="p-1 text-right">{f.conLista ? dinero(f.conLista) : ""}</td>
                <td className={`p-1 text-right ${COLOR_ESTADO[a.estado]}`}>{dinero(a.restante)}</td>
                <td className={`p-1 ${COLOR_ESTADO[a.estado]}`}>{a.pct != null ? `${a.pct}%` : ""} {TEXTO_ESTADO[a.estado]}</td>
                <td className="p-1 text-right">{editar && <button className="text-xs text-indigo-700 underline" onClick={() => editar(f)}>{f.presupuesto == null ? "presupuestar" : "editar"}</button>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr className="border-t font-medium"><td className="p-1" colSpan={2}>Total</td><td className="p-1 text-right">{dinero(tot.p)}</td><td className="p-1 text-right" colSpan={2}>{dinero(tot.e)}</td><td className="p-1 text-right">{dinero(tot.p - tot.e)}</td><td colSpan={2} /></tr></tfoot>
      </table>
    </div>
  );
}

function Presupuesto() {
  const qc = useQueryClient();
  const { soloConsulta, perfil } = useAuth();
  const puede = !soloConsulta && perfil?.rol !== "corporativo";
  const obras = useObras();
  const [texto, setTexto] = useState("");
  const [obraId, setObraId] = useState("");
  const [form, setForm] = useState<{ partida: string; subpartida: string; monto: string } | null>(null);
  const [error, setError] = useState("");
  const avance = useQuery({
    queryKey: ["mo-avance", obraId || "todas"],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("fn_mo_presupuesto_avance", { p_proyecto: obraId || null });
      if (e) throw e;
      return (data ?? []) as (AvancePartida & { proyecto_id: string; obra: string })[];
    },
  });
  const porObra = useMemo(() => {
    const m = new Map<string, { obra: string; id: string; p: number; e: number; excedidas: number }>();
    for (const f of avance.data ?? []) {
      const x = m.get(f.proyecto_id) ?? { obra: f.obra, id: f.proyecto_id, p: 0, e: 0, excedidas: 0 };
      x.p += Number(f.presupuesto ?? 0);
      x.e += Number(f.ejercido);
      if (avancePresupuesto(f).estado === "excedido") x.excedidas += 1;
      m.set(f.proyecto_id, x);
    }
    return [...m.values()].sort((a, b) => b.e - a.e);
  }, [avance.data]);

  async function guardar() {
    setError("");
    if (!form || !obraId) return;
    if (!form.partida.trim() || !(Number(form.monto) >= 0) || form.monto === "") return setError("Escribe partida y monto.");
    const { data: existentes, error: e1 } = await supabase.from("mo_presupuestos").select("id, partida, subpartida").eq("proyecto_id", obraId);
    if (e1) return setError(e1.message);
    const k = (p: string, s: string | null) => `${p.trim().toUpperCase()}|${(s ?? "").trim().toUpperCase()}`;
    const ya = (existentes ?? []).find((x) => k(x.partida, x.subpartida) === k(form.partida, form.subpartida));
    const fila = { proyecto_id: obraId, empresa_id: obras.data?.find((o) => o.id === obraId)?.empresa_id, partida: form.partida.trim(), subpartida: form.subpartida.trim() || null, monto: Number(form.monto) };
    const { error: e2 } = ya ? await supabase.from("mo_presupuestos").update({ monto: fila.monto }).eq("id", ya.id) : await supabase.from("mo_presupuestos").insert(fila);
    if (e2) return setError(e2.message);
    setForm(null);
    await qc.invalidateQueries({ queryKey: ["mo-avance"] });
    await qc.invalidateQueries({ queryKey: ["mo-catalogo"] });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-72 flex-1 text-sm">Obra
          <CampoBuscador value={texto} onChange={(t) => { setTexto(t); if (!t) setObraId(""); }} opciones={(obras.data ?? []).map((o) => ({ clave: o.id, titulo: o.nombre, detalle: o.empresa_codigo }))}
            onElegir={(id) => { setObraId(id); setTexto(obras.data?.find((o) => o.id === id)?.nombre ?? ""); }} placeholder="Todas las obras (busca una para capturar su presupuesto)" className="w-full rounded border px-2 py-1.5" />
        </label>
        {obraId && <button className="rounded border px-2 py-1.5 text-sm" onClick={() => { setObraId(""); setTexto(""); }}>Ver todas</button>}
        {obraId && puede && <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={() => setForm({ partida: "", subpartida: "", monto: "" })}>+ Partida</button>}
      </div>
      {form && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-indigo-200 bg-indigo-50 p-3">
          <input className="rounded border px-2 py-1.5 text-sm" placeholder="Partida" value={form.partida} onChange={(e) => setForm({ ...form, partida: e.target.value })} />
          <input className="rounded border px-2 py-1.5 text-sm" placeholder="Subpartida (opcional)" value={form.subpartida} onChange={(e) => setForm({ ...form, subpartida: e.target.value })} />
          <input className="w-36 rounded border px-2 py-1.5 text-sm" placeholder="Monto pactado" inputMode="decimal" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} />
          <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={guardar}>Guardar</button>
          <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setForm(null)}>Cancelar</button>
          {error && <p className="w-full text-sm text-rose-700">{error}</p>}
        </div>
      )}
      {avance.error && <p className="text-sm text-rose-700">{errorTexto(avance.error)}</p>}
      {obraId ? (
        <div className="rounded border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs text-slate-500">Pagado = mano de obra del backoffice y listas autorizadas aquí, por partida y subpartida.</p>
          <TablaAvance filas={avance.data ?? []} editar={puede ? (f) => setForm({ partida: f.partida, subpartida: f.subpartida ?? "", monto: f.presupuesto == null ? "" : String(f.presupuesto) }) : undefined} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Obra</th><th className="p-2 text-right">Presupuesto</th><th className="p-2 text-right">Pagado</th><th className="p-2 text-right">Restante</th><th className="p-2">Partidas excedidas</th></tr></thead>
            <tbody>
              {porObra.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="p-2"><button className="text-left text-indigo-700 underline" onClick={() => { setObraId(o.id); setTexto(o.obra); }}>{o.obra}</button></td>
                  <td className="p-2 text-right">{o.p ? dinero(o.p) : <span className="text-slate-400">sin presupuesto</span>}</td>
                  <td className="p-2 text-right">{dinero(o.e)}</td>
                  <td className={`p-2 text-right ${o.p && o.p - o.e < 0 ? "text-rose-700" : ""}`}>{o.p ? dinero(o.p - o.e) : ""}</td>
                  <td className="p-2">{o.excedidas ? <span className="text-rose-700">{o.excedidas}</span> : ""}</td>
                </tr>
              ))}
              {!avance.isLoading && !porObra.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Sin datos.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Trabajadores({ puedeEditar }: { puedeEditar: boolean }) {
  const qc = useQueryClient();
  const trabajadores = useTrabajadores();
  const [buscar, setBuscar] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [form, setForm] = useState<Partial<Trabajador> | null>(null);
  const [error, setError] = useState("");
  const filas = filtrarPorTexto((trabajadores.data ?? []).filter((t) => inactivos || t.activo), buscar, (t) => [t.nombre, t.puesto, t.backoffice_id?.toString()]);

  async function guardar() {
    setError("");
    if (!form?.nombre?.trim()) return setError("Escribe el nombre.");
    const clabe = (form.clabe ?? "").replace(/\D/g, "") || null;
    if (clabe && clabe.length !== 18) return setError("La CLABE lleva 18 dígitos.");
    const fila = { nombre: form.nombre.trim(), tipo: form.tipo ?? "empleado", puesto: form.puesto?.trim() || null, forma_pago: form.forma_pago ?? "transferencia", banco: form.banco?.trim() || null, clabe, notas: form.notas?.trim() || null, activo: form.activo ?? true };
    const { error: e } = form.id ? await supabase.from("mo_trabajadores").update(fila).eq("id", form.id) : await supabase.from("mo_trabajadores").insert(fila);
    if (e) return setError(e.message);
    setForm(null);
    await qc.invalidateQueries({ queryKey: ["mo-trabajadores"] });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="min-w-64 flex-1 rounded border px-2 py-1.5 text-sm" placeholder="Buscar trabajador o puesto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> ver inactivos</label>
        {puedeEditar && <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={() => setForm({ tipo: "empleado", forma_pago: "transferencia", activo: true })}>+ Trabajador</button>}
      </div>
      {form && (
        <div className="grid gap-2 rounded border border-indigo-200 bg-indigo-50 p-3 md:grid-cols-4">
          <input className="rounded border px-2 py-1.5 text-sm md:col-span-2" placeholder="Nombre completo" value={form.nombre ?? ""} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <select className="rounded border px-2 py-1.5 text-sm" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoTrabajador })}><option value="empleado">Empleado</option><option value="contratista">Contratista</option></select>
          <input className="rounded border px-2 py-1.5 text-sm" placeholder="Puesto (oficial, ayudante…)" value={form.puesto ?? ""} onChange={(e) => setForm({ ...form, puesto: e.target.value })} />
          <select className="rounded border px-2 py-1.5 text-sm" value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value as FormaPago })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select>
          <input className="rounded border px-2 py-1.5 text-sm" placeholder="Banco" value={form.banco ?? ""} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
          <input className="rounded border px-2 py-1.5 text-sm" placeholder="CLABE (18 dígitos)" inputMode="numeric" value={form.clabe ?? ""} onChange={(e) => setForm({ ...form, clabe: e.target.value })} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.activo ?? true} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> activo</label>
          <input className="rounded border px-2 py-1.5 text-sm md:col-span-3" placeholder="Notas" value={form.notas ?? ""} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          <div className="flex gap-2"><button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white" onClick={guardar}>Guardar</button><button className="rounded border px-3 py-1.5 text-sm" onClick={() => setForm(null)}>Cancelar</button></div>
          {error && <p className="text-sm text-rose-700 md:col-span-4">{error}</p>}
        </div>
      )}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Nombre</th><th className="p-2">Tipo</th><th className="p-2">Puesto</th><th className="p-2">Forma de pago</th><th className="p-2">Banco / CLABE</th><th className="p-2">Id backoffice</th><th className="p-2" /></tr></thead>
          <tbody>
            {filas.slice(0, 400).map((t) => (
              <tr key={t.id} className={`border-t border-slate-100 ${t.activo ? "" : "text-slate-400"}`}>
                <td className="p-2">{t.nombre}</td><td className="p-2">{t.tipo === "contratista" ? "Contratista" : "Empleado"}</td><td className="p-2">{t.puesto}</td>
                <td className="p-2">{t.forma_pago === "efectivo" ? "Efectivo" : "Transferencia"}</td>
                <td className="p-2 text-xs">{t.banco} {t.clabe ? `· ${t.clabe}` : ""}</td><td className="p-2 text-xs">{t.backoffice_id ?? ""}</td>
                <td className="p-2 text-right">{puedeEditar && <button className="text-xs text-indigo-700 underline" onClick={() => setForm(t)}>editar</button>}</td>
              </tr>
            ))}
            {!trabajadores.isLoading && !filas.length && <tr><td colSpan={7} className="p-4 text-center text-slate-500">Sin trabajadores.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{filas.length} trabajadores. Los que tienen Id del backoffice vienen de la API de mano de obra.</p>
    </section>
  );
}
