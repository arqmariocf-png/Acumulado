import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { claseDe } from "../../lib/personaje";
import { CamaraSelfie } from "../CamaraSelfie";
import { AvatarPixel } from "./AvatarPixel";
import { generarAvatar } from "./datos";

const DETALLES = [
  { lado: 28, etiqueta: "Retro" },
  { lado: 40, etiqueta: "Normal" },
  { lado: 56, etiqueta: "Detallado" },
];

/** Crear o cambiar el personaje: selfie de frente → pixel-art → guardar. */
export function CrearAvatar({ alTerminar }: { alTerminar?: () => void }) {
  const { perfilReal, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const archivo = useRef<HTMLInputElement>(null);
  const [camara, setCamara] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [lado, setLado] = useState(40);
  const [zoom, setZoom] = useState(1.5);
  const [vista, setVista] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const clase = claseDe(perfilReal?.rol, perfilReal?.modulos ?? []);

  useEffect(() => {
    if (!foto) return;
    let vigente = true;
    generarAvatar(foto, lado, zoom)
      .then((url) => vigente && setVista(url))
      .catch((e: Error) => vigente && setAviso(e.message));
    return () => {
      vigente = false;
    };
  }, [foto, lado, zoom]);

  const sinCamara = useCallback((motivo: string) => {
    setCamara(false);
    setAviso(motivo);
  }, []);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfilReal || !vista) throw new Error("Primero tómate la foto.");
      const { error } = await supabase
        .from("personajes")
        .upsert({ profile_id: perfilReal.id, avatar: vista, fondo: clase.color, titulo: titulo.trim() || null }, { onConflict: "profile_id" });
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
        Tómate una foto <b>de frente</b>, con la cara al centro y buena luz. El sistema la convierte en tu personaje pixel-art; <b>la foto no se guarda</b>, solo
        el muñequito.
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
      {vista && (
        <div className="flex flex-wrap items-center gap-4">
          <AvatarPixel avatar={vista} nombre={perfilReal?.nombre ?? ""} color={clase.color} tamano={128} />
          <div className="space-y-2 text-sm">
            <div className="flex gap-1">
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
            <button type="button" disabled={guardar.isPending} onClick={() => guardar.mutate()} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white">
              {guardar.isPending ? "Guardando…" : "¡Este es mi personaje!"}
            </button>
            {guardar.error && <p className="text-red-600">{(guardar.error as Error).message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
