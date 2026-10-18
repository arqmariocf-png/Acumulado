import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { claseDe } from "../lib/personaje";
import { AvatarPixel } from "./personaje/AvatarPixel";

export interface PersonaCredencial {
  profile_id: string;
  nombre: string;
  rol: string;
  empresa_id: string | null;
  empresa: string | null;
  avatar: string | null;
  titulo: string | null;
  expediente: boolean;
  comedor: { id: string; estado: string; total: number; detalle: string } | null;
  herramientas: { id: string; folio: string; nombre: string; obra: string | null; devolver_el: string | null }[];
}

async function leerCredencial(codigo: string): Promise<PersonaCredencial> {
  const { data, error } = await supabase.rpc("fn_credencial_leer", { p_codigo: codigo.trim() });
  if (error) throw new Error(error.message);
  return data as PersonaCredencial;
}

/** Lee la credencial QR del personaje: con la cámara del equipo o con un
 * lector de mano (escribe el código y Enter). Quien atiende comedor,
 * almacén o mostrador ve quién es. */
export function LectorCredencial({ titulo = "Escanear credencial", onLeida }: { titulo?: string; onLeida: (p: PersonaCredencial) => void }) {
  const [texto, setTexto] = useState("");
  const [camara, setCamara] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  async function procesar(codigo: string) {
    if (!codigo.trim() || leyendo) return;
    setLeyendo(true);
    setError(null);
    try {
      onLeida(await leerCredencial(codigo));
      setTexto("");
      setCamara(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">🪪 {titulo}</span>
        <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setCamara((v) => !v)}>
          {camara ? "Cerrar cámara" : "📷 Con la cámara"}
        </button>
        <input
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="…o con el lector de mano (Enter)"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void procesar(texto);
            }
          }}
        />
      </div>
      {camara && <CamaraQr onCodigo={(c) => void procesar(c)} />}
      {leyendo && <p className="mt-1 text-xs text-slate-500">Leyendo…</p>}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function CamaraQr({ onCodigo }: { onCodigo: (codigo: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [aviso, setAviso] = useState<string | null>("Abriendo la cámara…");
  const ultimo = useRef("");
  const avisar = useRef(onCodigo);
  avisar.current = onCodigo;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cuadro = 0;
    let vivo = true;
    const lienzo = document.createElement("canvas");
    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!vivo || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => undefined);
        setAviso(null);
        const ctx = lienzo.getContext("2d", { willReadFrequently: true });
        const revisar = () => {
          if (!vivo) return;
          const v = video.current;
          if (v && ctx && v.videoWidth) {
            const escala = Math.min(1, 640 / v.videoWidth);
            lienzo.width = Math.round(v.videoWidth * escala);
            lienzo.height = Math.round(v.videoHeight * escala);
            ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (qr?.data && qr.data !== ultimo.current) {
              ultimo.current = qr.data;
              avisar.current(qr.data);
            }
          }
          cuadro = requestAnimationFrame(revisar);
        };
        cuadro = requestAnimationFrame(revisar);
      } catch {
        setAviso("No se pudo abrir la cámara. Usa el lector de mano o escribe el código.");
      }
    })();
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="mt-2">
      <video ref={video} playsInline muted className="mx-auto max-h-64 w-full max-w-sm rounded bg-black object-cover" />
      {aviso && <p className="mt-1 text-xs text-slate-500">{aviso}</p>}
    </div>
  );
}

/** Ficha de la persona leída. */
export function FichaCredencial({ persona, children }: { persona: PersonaCredencial; children?: React.ReactNode }) {
  const clase = claseDe(persona.rol);
  return (
    <div className="flex flex-wrap items-start gap-3 rounded border-2 border-emerald-500 bg-emerald-50 p-3">
      <AvatarPixel avatar={persona.avatar} nombre={persona.nombre} color={clase.color} tamano={64} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-slate-900">{persona.nombre}</p>
        <p className="text-xs text-slate-600">
          {clase.icono} {persona.titulo || clase.nombre} · {persona.empresa ?? "sin empresa"}
          {!persona.expediente && <span className="text-amber-700"> · sin expediente en RH</span>}
        </p>
        {children}
      </div>
    </div>
  );
}
