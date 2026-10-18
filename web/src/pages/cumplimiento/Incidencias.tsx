import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import {
  CLASE_SEVERIDAD,
  ETIQUETA_AREA,
  ETIQUETA_ESTATUS_INCIDENCIA,
  ETIQUETA_SEVERIDAD,
  faltantesIncidencia,
  htmlInformeIncidencia,
  textoIncidencia,
  type EstatusIncidencia,
  type Severidad,
} from "../../lib/cumplimientoNormativo";
import { AccionesRegistradas, NuevasTareas } from "./AccionesTareas";
import { type IncidenciaFila } from "./datos";
import { useIncidencias } from "./datos";
import { boton, botonSuave, campo, fechaCorta, hoyMexico, useDirectorio, veCumplimiento } from "./comun";



/** Paso 3: informe de incidencia, con calma y a tiempo. */
export function Incidencias() {
  const { perfil, soloConsulta } = useAuth();
  const escribe = veCumplimiento(perfil) && !soloConsulta;
  const incidencias = useIncidencias();
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);
  const lista = (incidencias.data ?? []).filter((i) => todas || i.estatus !== "cerrada");

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Una brecha se comunica con calma y a tiempo: qué pasó, qué significa, qué hicimos ya, qué sigue y cuándo volvemos a informar. El informe sale listo para
        imprimir o mandar por WhatsApp.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {escribe && (
          <button className={boton} onClick={() => setNueva((v) => !v)}>
            {nueva ? "Cerrar" : "+ Registrar incidencia"}
          </button>
        )}
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> ver también las cerradas
        </label>
      </div>
      {nueva && (
        <FormIncidencia
          alGuardar={(id) => {
            setNueva(false);
            setAbierta(id);
          }}
        />
      )}
      {incidencias.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {!incidencias.isLoading && !lista.length && <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">Sin incidencias abiertas.</p>}
      <ul className="space-y-2">
        {lista.map((i) => (
          <li key={i.id} className="rounded border border-slate-200 bg-white">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setAbierta(abierta === i.id ? null : i.id)}>
              <span>
                <span className="mr-2 font-mono text-xs text-slate-500">{i.folio}</span>
                <span className="font-medium text-slate-900">{i.titulo}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {i.empresas?.codigo} · {fechaCorta(i.detectada_el)}
                  {i.responsable_nombre ? ` · ${i.responsable_nombre}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                {i.estatus !== "cerrada" && i.proxima_actualizacion && i.proxima_actualizacion < hoyMexico() && (
                  <span className="text-red-700">actualización vencida</span>
                )}
                <span className={`rounded px-2 py-0.5 ${CLASE_SEVERIDAD[i.severidad]}`}>{ETIQUETA_SEVERIDAD[i.severidad]}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">{ETIQUETA_ESTATUS_INCIDENCIA[i.estatus]}</span>
              </span>
            </button>
            {abierta === i.id && <DetalleIncidencia inc={i} escribe={escribe} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Inicial = Partial<Pick<IncidenciaFila, "titulo" | "area" | "que_paso" | "control_id" | "prueba_id">>;

export function FormIncidencia({ inc, inicial, alGuardar }: { inc?: IncidenciaFila; inicial?: Inicial; alGuardar: (id: string) => void }) {
  const qc = useQueryClient();
  const personas = useDirectorio();
  const empresas = useEmpresasAlcance();
  const hoy = hoyMexico();
  const [empresaId, setEmpresaId] = useState(inc?.empresa_id ?? "");
  const [f, setF] = useState({
    titulo: inc?.titulo ?? inicial?.titulo ?? "",
    severidad: inc?.severidad ?? ("media" as Severidad),
    area: inc?.area ?? inicial?.area ?? "otro",
    detectada_el: inc?.detectada_el ?? hoy,
    ocurrio_el: inc?.ocurrio_el ?? "",
    que_paso: inc?.que_paso ?? inicial?.que_paso ?? "",
    impacto: inc?.impacto ?? "",
    monto_estimado: inc?.monto_estimado != null ? String(inc.monto_estimado) : "",
    personas_afectadas: inc?.personas_afectadas ?? "",
    causa: inc?.causa ?? "",
    acciones_inmediatas: inc?.acciones_inmediatas ?? "",
    acciones_correctivas: inc?.acciones_correctivas ?? "",
    proxima_actualizacion: inc?.proxima_actualizacion ?? "",
    responsable_id: inc?.responsable_id ?? "",
  });
  const set = (c: Partial<typeof f>) => setF((x) => ({ ...x, ...c }));
  const { empresasAlcance } = useAuth();
  const empresa = empresaId || (empresas.data?.length === 1 ? empresas.data[0].id : "") || (empresas.data && empresasAlcance.length === 1 ? empresasAlcance[0] : "");
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.titulo.trim()) throw new Error("Ponle un título corto a la incidencia.");
      if (!empresa) throw new Error("Elige la empresa.");
      const fila = {
        empresa_id: empresa,
        titulo: f.titulo.trim(),
        severidad: f.severidad,
        area: f.area,
        detectada_el: f.detectada_el || hoy,
        ocurrio_el: f.ocurrio_el || null,
        que_paso: f.que_paso.trim() || null,
        impacto: f.impacto.trim() || null,
        monto_estimado: f.monto_estimado ? Number(f.monto_estimado) : null,
        personas_afectadas: f.personas_afectadas.trim() || null,
        causa: f.causa.trim() || null,
        acciones_inmediatas: f.acciones_inmediatas.trim() || null,
        acciones_correctivas: f.acciones_correctivas.trim() || null,
        proxima_actualizacion: f.proxima_actualizacion || null,
        responsable_id: f.responsable_id || null,
        ...(inc ? {} : { control_id: inicial?.control_id ?? null, prueba_id: inicial?.prueba_id ?? null }),
      };
      const r = inc
        ? await supabase.from("cumplimiento_incidencias").update(fila).eq("id", inc.id).select("id").single()
        : await supabase.from("cumplimiento_incidencias").insert(fila).select("id").single();
      if (r.error) throw r.error;
      return r.data.id as string;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["cumplimiento-incidencias"] });
      alGuardar(id);
    },
  });
  const area = (k: keyof typeof f, etiqueta: string, ayuda?: string) => (
    <label className="text-sm sm:col-span-2">
      {etiqueta}
      {ayuda && <span className="ml-1 text-xs text-slate-400">{ayuda}</span>}
      <textarea className={campo} rows={2} value={f[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<typeof f>)} />
    </label>
  );
  return (
    <form
      className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
      data-sin-borrador={inc ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <label className="text-sm sm:col-span-2">
        Título
        <input className={campo} value={f.titulo} placeholder="Ej. Pago duplicado a proveedor; accidente en obra; fuga de información" onChange={(e) => set({ titulo: e.target.value })} />
      </label>
      <div className="text-sm">
        Empresa
        {inc ? (
          <p className="py-1.5">{inc.empresas?.nombre}</p>
        ) : (
          <SelectorEmpresa value={empresa} onChange={setEmpresaId} vacio="Elige empresa…" className={campo} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Severidad
          <select className={campo} value={f.severidad} onChange={(e) => set({ severidad: e.target.value as Severidad })}>
            {Object.entries(ETIQUETA_SEVERIDAD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Área
          <select className={campo} value={f.area} onChange={(e) => set({ area: e.target.value })}>
            {Object.entries(ETIQUETA_AREA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Detectada el
          <input type="date" className={campo} value={f.detectada_el} onChange={(e) => set({ detectada_el: e.target.value })} />
        </label>
        <label className="text-sm">
          Ocurrió el
          <input type="date" className={campo} value={f.ocurrio_el} onChange={(e) => set({ ocurrio_el: e.target.value })} />
        </label>
      </div>
      <label className="text-sm">
        Responsable de atenderla
        <select className={campo} value={f.responsable_id} onChange={(e) => set({ responsable_id: e.target.value })}>
          <option value="">—</option>
          {(personas.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      {area("que_paso", "1. Qué pasó", "hechos, sin adjetivos")}
      {area("impacto", "2. Qué significa", "a quién o qué afecta")}
      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
        <label className="text-sm">
          Monto estimado
          <input type="number" step="0.01" className={campo} value={f.monto_estimado} onChange={(e) => set({ monto_estimado: e.target.value })} />
        </label>
        <label className="text-sm">
          Personas afectadas
          <input className={campo} value={f.personas_afectadas} onChange={(e) => set({ personas_afectadas: e.target.value })} />
        </label>
      </div>
      {area("causa", "3. Por qué pasó")}
      {area("acciones_inmediatas", "4. Qué hicimos ya", "para contenerla")}
      {area("acciones_correctivas", "5. Qué sigue", "para que no se repita")}
      <label className="text-sm">
        6. Próxima actualización el
        <input type="date" className={campo} value={f.proxima_actualizacion} onChange={(e) => set({ proxima_actualizacion: e.target.value })} />
      </label>
      <div className="flex items-end gap-2">
        <button className={boton} disabled={guardar.isPending}>
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {guardar.error && <p className="text-sm text-red-600 sm:col-span-2">{(guardar.error as Error).message}</p>}
    </form>
  );
}

function DetalleIncidencia({ inc, escribe }: { inc: IncidenciaFila; escribe: boolean }) {
  const qc = useQueryClient();
  const [editar, setEditar] = useState(false);
  const [tareas, setTareas] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [comunicadoA, setComunicadoA] = useState(inc.comunicado_a ?? "");
  const faltan = faltantesIncidencia(inc);
  const actualizar = useMutation({
    mutationFn: async (cambio: Record<string, unknown>) => {
      const { error } = await supabase.from("cumplimiento_incidencias").update(cambio).eq("id", inc.id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cumplimiento-incidencias"] }),
  });
  const texto = textoIncidencia(inc);

  if (editar) return <div className="border-t border-slate-100 p-3"><FormIncidencia inc={inc} alGuardar={() => setEditar(false)} /></div>;
  return (
    <div className="space-y-3 border-t border-slate-100 p-3 text-sm">
      {faltan.length > 0 && <p className="rounded bg-amber-50 px-2 py-1 text-amber-800">Para que el informe se entienda falta: {faltan.join(", ")}.</p>}
      <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-[13px] text-slate-800">{texto}</pre>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={botonSuave}
          onClick={() => {
            const v = abrirVentanaImpresion();
            abrirParaImprimir(htmlInformeIncidencia(inc, hoyMexico()), v);
          }}
        >
          Imprimir / PDF
        </button>
        <button
          className={botonSuave}
          onClick={() => {
            void navigator.clipboard?.writeText(texto.replace(/\*/g, "")).then(() => setCopiado(true));
          }}
        >
          {copiado ? "Copiado" : "Copiar texto"}
        </button>
        <a className={botonSuave} href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
          Mandar por WhatsApp
        </a>
        {escribe && (
          <>
            <button className={botonSuave} onClick={() => setEditar(true)}>
              Editar
            </button>
            <select className={`${campo} max-w-[10rem]`} value={inc.estatus} onChange={(e) => actualizar.mutate({ estatus: e.target.value as EstatusIncidencia })}>
              {Object.entries(ETIQUETA_ESTATUS_INCIDENCIA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {escribe && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${campo} max-w-sm`} value={comunicadoA} placeholder="¿A quién se le informó? (dirección, cliente, IMSS…)" onChange={(e) => setComunicadoA(e.target.value)} />
          <button
            className={botonSuave}
            disabled={!comunicadoA.trim()}
            onClick={() => actualizar.mutate({ comunicado_a: comunicadoA.trim(), comunicado_en: new Date().toISOString() })}
          >
            Marcar como informada
          </button>
          {inc.comunicado_en && (
            <span className="text-xs text-slate-500">
              Informada a {inc.comunicado_a} el {fechaCorta(inc.comunicado_en)}
            </span>
          )}
        </div>
      )}
      {actualizar.error && <p className="text-red-600">{(actualizar.error as Error).message}</p>}
      <div>
        <h4 className="mb-1 font-medium text-slate-800">Acciones correctivas</h4>
        <AccionesRegistradas incidenciaId={inc.id} />
      </div>
      {escribe &&
        (tareas ? (
          <NuevasTareas
            inicial={(inc.acciones_correctivas ?? "")
              .split(/\n|;/)
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => ({ texto: t, responsable_id: inc.responsable_id, fecha: inc.proxima_actualizacion ?? null }))}
            origen={{ incidencia_id: inc.id }}
            prefijo={`Incidencia ${inc.folio ?? ""}`.trim()}
            descripcion={`${inc.titulo}. ${inc.que_paso ?? ""}`.trim()}
            alTerminar={() => setTareas(false)}
          />
        ) : (
          <button className={boton} onClick={() => setTareas(true)}>
            Volver tareas las acciones correctivas
          </button>
        ))}
    </div>
  );
}
