import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { claseDe } from "../../lib/personaje";
import { CamaraSelfie } from "../CamaraSelfie";
import { AvatarPixel } from "./AvatarPixel";
import { generarAvatar, generarAvatarIa, type EstiloAvatar } from "./datos";

const DETALLES = [
  { lado: 28, etiqueta: "Retro" },
  { lado: 40, etiqueta: "Normal" },
  { lado: 56, etiqueta: "Detallado" },
];

/** Crear o cambiar el personaje: selfie de frente → personaje de videojuego
 * generado por IA, retrato realista o pixel-art → guardar. */
export function CrearAvatar({ alTerminar }: { alTerminar?: () => void }) {
  const { perfilReal, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const archivo = useRef<HTMLInputElement>(null);
  const [camara, setCamara] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [estilo, setEstilo] = useState<EstiloAvatar>("ia");
  const [vistaIa, setVistaIa] = useState<string | null>(null);
  const [aceptoIa, setAceptoIa] = useState(false);
  const [restantes, setRestantes] = useState<number | null>(null);
  const [lado, setLado] = useState(40);
  const [zoom, setZoom] = useState(1.5);
  const [vista, setVista] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const clase = claseDe(perfilReal?.rol, perfilReal?.modulos ?? []);

  useEffect(() => {
    if (!foto || estilo === "ia") return;
    let vigente = true;
    generarAvatar(foto, lado, zoom, estilo)
      .then((url) => vigente && setVista(url))
      .catch((e: Error) => vigente && setAviso(e.message));
    return () => {
      vigente = false;
    };
  }, [foto, lado, zoom, estilo]);

  const sinCamara = useCallback((motivo: string) => {
    setCamara(false);
    setAviso(motivo);
  }, []);

  const crearIa = useMutation({
    mutationFn: async () => {
      if (!foto) throw new Error("Primero tómate la foto.");
      return generarAvatarIa(foto, zoom, clase.color);
    },
    onSuccess: (r) => {
      setVistaIa(r.avatar);
      setRestantes(r.restantes);
    },
  });
  const elegida = estilo === "ia" ? vistaIa : vista;

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfilReal || !elegida) throw new Error("Primero tómate la foto.");
      const { error } = await supabase
        .from("personajes")
        .upsert({ profile_id: perfilReal.id, avatar: elegida, fondo: clase.color, titulo: titulo.trim() || null }, { onConflict: "profile_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mi-avatar"] });
      void qc.invalidateQueries({ queryKey: ["equipo-personajes"] });
      alTerminar?.();
    },
  });

  return (
    <div className="space-y-3 rounded-lg border-2 border-slate-900 bg-amber-50 p-4">
      <p className="text-sm text-slate-700">
        Tómate una foto <b>de frente</b>, con la cara al centro y buena luz. Elige <b>personaje IA</b> (te convierte en personaje de videojuego realista),{" "}
        <b>realista</b> (tu foto retocada) o <b>videojuego</b> (muñequito pixel-art). Solo se guarda el retrato que elijas, que verá tu equipo.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={soloConsulta} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => setCamara(true)}>
          📷 {foto ? "Tomar otra" : "Tomarme la foto"}
        </button>
        <button type="button" className="rounded border border-slate-400 px-3 py-2 text-sm" onClick={() => archivo.current?.click()}>
          Elegir de la galería
        </button>
        <input
          ref={archivo}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFoto(f);
            e.target.value = "";
          }}
        />
      </div>
      <CamaraSelfie
        abierta={camara}
        onCerrar={() => setCamara(false)}
        onSinCamara={sinCamara}
        onCaptura={(b) => {
          setCamara(false);
          setAviso(null);
          setFoto(b);
        }}
      />
      {aviso && <p className="text-sm text-amber-800">{aviso}</p>}
      {foto && (
        <div className="flex flex-wrap items-center gap-4">
          {elegida ? (
            <AvatarPixel avatar={elegida} nombre={perfilReal?.nombre ?? ""} color={clase.color} tamano={128} />
          ) : (
            <span className="flex h-32 w-32 items-center justify-center rounded-lg border-2 border-dashed border-slate-400 p-2 text-center text-xs text-slate-500">
              {crearIa.isPending ? "Creando tu personaje… (puede tardar hasta un minuto)" : "Aquí saldrá tu personaje"}
            </span>
          )}
          <div className="space-y-2 text-sm">
            <div className="flex gap-1">
              {(["ia", "realista", "pixel"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEstilo(e)}
                  className={`rounded border px-2 py-1 ${estilo === e ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}
                >
                  {e === "ia" ? "✨ Personaje IA" : e === "realista" ? "📸 Realista" : "👾 Videojuego"}
                </button>
              ))}
            </div>
            <div className={`flex gap-1 ${estilo === "pixel" ? "" : "hidden"}`}>
              {DETALLES.map((d) => (
                <button
                  key={d.lado}
                  type="button"
                  onClick={() => setLado(d.lado)}
                  className={`rounded border px-2 py-1 ${lado === d.lado ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}
                >
                  {d.etiqueta}
                </button>
              ))}
            </div>
            {estilo === "ia" && (
              <div className="max-w-xs space-y-1 rounded border border-violet-200 bg-violet-50 p-2">
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={aceptoIa} onChange={(e) => setAceptoIa(e.target.checked)} />
                  <span>Acepto que mi foto se mande a un servicio externo de inteligencia artificial solo para crear mi personaje. Acumulado no guarda la foto.</span>
                </label>
                <button
                  type="button"
                  disabled={!aceptoIa || crearIa.isPending || soloConsulta}
                  onClick={() => crearIa.mutate()}
                  className="rounded bg-violet-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                >
                  {crearIa.isPending ? "Creando…" : vistaIa ? "✨ Crear otro" : "✨ Crear mi personaje"}
                </button>
                {restantes != null && <p className="text-xs text-slate-500">Te quedan {restantes} intento(s) hoy.</p>}
                {crearIa.error && <p className="text-xs text-red-600">{(crearIa.error as Error).message}</p>}
              </div>
            )}
            <label className="block">
              Acercar
              <input type="range" min={1} max={2.4} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="block w-48" />
            </label>
            <label className="block">
              Tu título (opcional)
              <input
                className="block w-56 rounded border border-slate-300 px-2 py-1"
                maxLength={40}
                value={titulo}
                placeholder={clase.nombre}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </label>
            <button type="button" disabled={guardar.isPending || !elegida} onClick={() => guardar.mutate()} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {guardar.isPending ? "Guardando…" : "¡Este es mi personaje!"}
            </button>
            {guardar.error && <p className="text-red-600">{(guardar.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
