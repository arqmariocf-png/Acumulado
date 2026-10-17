import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { FRASES_AGRADECIMIENTO, LIMITE_MENSAJE, fraseSugerida, frasesSinUsar, sabadosSiguientes, yaPasoEnvio } from "../../lib/mensajeSemana";

// Mensaje de la semana (17-oct-2026, Mario: "programados, pero el mensaje
// mándame primero a mí para escribirles el agradecimiento de la semana;
// genérame frases y las elijo semana con semana"). Se elige o escribe la
// frase, se prueba (te llega solo a ti) y queda programada para el sábado a
// la 1 p. m.; sale por notificación a todos los que la tienen activada.

interface Mensaje {
  id: string;
  fecha: string;
  texto: string;
  enviado_en: string | null;
  enviados: number | null;
  fallidos: number | null;
}

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

async function llamar(body: Record<string, unknown>): Promise<{ enviados?: number; personas?: number; fallidos?: number }> {
  const { data, error } = await supabase.functions.invoke("push-mensaje-semana", { body });
  if (error) {
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detalle?.error ?? error.message);
  }
  return data;
}

export function MensajeSemana() {
  const { esAdminGlobal } = useAuth();
  if (!esAdminGlobal) return <p className="p-8 text-center text-sm text-slate-500">Solo el director general programa el mensaje de la semana.</p>;
  return <MensajeSemanaDirector />;
}

function MensajeSemanaDirector() {
  const qc = useQueryClient();
  const sabados = sabadosSiguientes(hoy(), 6);
  const [fecha, setFecha] = useState(sabados[0]);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: mensajes = [] } = useQuery({
    queryKey: ["mensajes-semana"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mensajes_semana").select("id, fecha, texto, enviado_en, enviados, fallidos").order("fecha", { ascending: false }).limit(60);
      if (error) throw error;
      return (data ?? []) as Mensaje[];
    },
  });
  const { data: conPush } = useQuery({
    queryKey: ["mensaje-semana-con-push"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mensaje_semana_destinatarios");
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
  });

  const delSabado = mensajes.find((m) => m.fecha === fecha) ?? null;
  const usadas = mensajes.map((m) => m.texto);
  const sinUsar = useMemo(() => frasesSinUsar(usadas), [usadas.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const yaSalio = !!delSabado?.enviado_en;
  const paso = yaPasoEnvio(fecha);

  useEffect(() => {
    setTexto(delSabado?.texto ?? fraseSugerida(fecha, sinUsar.length ? sinUsar : FRASES_AGRADECIMIENTO));
  }, [fecha, delSabado?.texto]); // eslint-disable-line react-hooks/exhaustive-deps

  const programar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("fn_mensaje_semana_programar", { p_fecha: fecha, p_texto: texto });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso(`Programado para el ${fechaLarga(fecha)} a la 1:00 p. m.`);
      qc.invalidateQueries({ queryKey: ["mensajes-semana"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const probar = useMutation({
    mutationFn: () => llamar({ modo: "prueba", texto }),
    onSuccess: () => setAviso("Te llegó la prueba a tus dispositivos. Revisa cómo se ve."),
    onError: (e: Error) => setError(e.message),
  });
  const ahora = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("fn_mensaje_semana_programar", { p_fecha: fecha, p_texto: texto });
      if (error) throw error;
      return llamar({ modo: "enviar_ahora", fecha });
    },
    onSuccess: (r) => {
      setAviso(`Enviado a ${r.personas ?? 0} personas.`);
      qc.invalidateQueries({ queryKey: ["mensajes-semana"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const ocupado = programar.isPending || probar.isPending || ahora.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Mensaje de la semana</h1>
        <p className="text-sm text-slate-600">
          Tu agradecimiento al equipo sale el sábado a la 1:00 p. m. por notificación a todos los que la tienen activada{conPush != null ? ` (hoy: ${conPush} personas)` : ""}. El viernes en la tarde te llega un aviso para elegirlo; si el sábado a las 10 aún no hay, te avisa otra vez.
        </p>
      </div>

      {aviso && (
        <div className="flex justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          <span>{aviso}</span>
          <button className="text-xs underline" onClick={() => setAviso(null)}>cerrar</button>
        </div>
      )}
      {error && (
        <div className="flex justify-between gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <span>{error}</span>
          <button className="text-xs underline" onClick={() => setError(null)}>cerrar</button>
        </div>
      )}

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">Sábado:</span>
          {sabados.map((s) => {
            const m = mensajes.find((x) => x.fecha === s);
            return (
              <button
                key={s}
                onClick={() => {
                  setFecha(s);
                  setAviso(null);
                  setError(null);
                }}
                className={`rounded border px-2 py-1 text-xs ${fecha === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              >
                {new Date(`${s}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                {m && (m.enviado_en ? " · enviado" : " · programado")}
              </button>
            );
          })}
        </div>

        <label className="block text-sm">
          <span className="text-slate-600">
            Mensaje del {fechaLarga(fecha)} · {texto.length}/{LIMITE_MENSAJE}
          </span>
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            rows={3}
            maxLength={LIMITE_MENSAJE}
            value={texto}
            disabled={yaSalio}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>

        {yaSalio ? (
          <p className="text-sm text-emerald-700">
            Enviado el {new Date(delSabado!.enviado_en!).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} a {delSabado!.enviados ?? 0} personas.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm" disabled={ocupado || !texto.trim()} onClick={() => probar.mutate()}>
              {probar.isPending ? "Enviando…" : "Mandármelo a mí primero"}
            </button>
            {!paso && (
              <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={ocupado || !texto.trim()} onClick={() => programar.mutate()}>
                {programar.isPending ? "Guardando…" : delSabado ? "Guardar cambios" : "Programar para la 1:00 p. m."}
              </button>
            )}
            <button
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-50"
              disabled={ocupado || !texto.trim() || fecha !== sabados[0]}
              onClick={() => {
                if (window.confirm("¿Mandar el mensaje a todos ahora mismo?")) ahora.mutate();
              }}
              title={fecha !== sabados[0] ? "Solo el de este sábado se puede mandar ya" : ""}
            >
              {ahora.isPending ? "Enviando…" : "Mandar a todos ahora"}
            </button>
            {delSabado && !paso && <span className="self-center text-xs text-emerald-700">Programado: sale el {fechaLarga(fecha)} a la 1:00 p. m.</span>}
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Frases para elegir {sinUsar.length < FRASES_AGRADECIMIENTO.length && <span className="font-normal text-slate-500">({sinUsar.length} sin usar)</span>}</h2>
        <ul className="space-y-1">
          {FRASES_AGRADECIMIENTO.map((f) => {
            const usada = !sinUsar.includes(f);
            return (
              <li key={f}>
                <button
                  disabled={yaSalio}
                  onClick={() => setTexto(f)}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${texto === f ? "bg-sky-50 ring-1 ring-sky-300" : ""} ${usada ? "text-slate-400" : "text-slate-800"}`}
                >
                  {f}
                  {usada && <span className="ml-1 text-xs">(ya usada)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {mensajes.some((m) => m.enviado_en) && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Enviados</h2>
          <ul className="space-y-1 text-sm">
            {mensajes
              .filter((m) => m.enviado_en)
              .map((m) => (
                <li key={m.id} className="border-t border-slate-100 pt-1">
                  <span className="text-xs text-slate-500">
                    {fechaLarga(m.fecha)} · {m.enviados ?? 0} personas
                  </span>
                  <div>{m.texto}</div>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
