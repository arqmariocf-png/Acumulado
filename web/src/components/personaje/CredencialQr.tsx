import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { claseDe, nivelDe } from "../../lib/personaje";
import { AvatarPixel } from "./AvatarPixel";
import { useMiAvatar, useMiPersonaje } from "./datos";

/** Credencial QR del personaje (18-oct-2026): para el comedor, el almacén
 * (herramienta y materiales) y el mostrador. El código dura 10 minutos y se
 * renueva solo cada minuto: una captura vieja no sirve. */
export function CredencialQr() {
  const { perfilReal } = useAuth();
  const avatar = useMiAvatar();
  const hoja = useMiPersonaje();
  const [ahora, setAhora] = useState(() => Date.now());
  const cred = useQuery({
    queryKey: ["mi-credencial"],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_mi_credencial");
      if (error) throw error;
      const c = data as { codigo: string; expira: string };
      const QRCode = await import("qrcode");
      const svg = await QRCode.toString(c.codigo, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
      return { ...c, svg };
    },
  });
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!perfilReal) return null;
  const clase = claseDe(perfilReal.rol, perfilReal.modulos ?? []);
  const segundos = cred.data ? Math.max(0, Math.round((Date.parse(cred.data.expira) - ahora) / 1000)) : 0;

  return (
    <section className="mx-auto max-w-sm rounded-xl border-2 border-slate-900 bg-white p-4 text-center shadow-[4px_4px_0_rgba(15,23,42,0.5)]">
      <div className="flex items-center justify-center gap-3">
        <AvatarPixel avatar={avatar.data?.avatar} nombre={perfilReal.nombre ?? ""} color={clase.color} tamano={56} nivel={hoja.data ? nivelDe(hoja.data.stats.xp).nivel : undefined} />
        <div className="text-left">
          <p className="font-semibold leading-tight text-slate-900">{perfilReal.nombre}</p>
          <p className="text-xs text-slate-500">
            {clase.icono} {avatar.data?.titulo || clase.nombre}
          </p>
        </div>
      </div>
      <div className="mx-auto mt-3 w-60">
        {cred.isLoading && <p className="py-20 text-sm text-slate-400">Generando tu QR…</p>}
        {cred.error && <p className="py-10 text-sm text-red-600">{(cred.error as Error).message}</p>}
        {cred.data && (
          <div className={segundos === 0 ? "opacity-20" : ""} dangerouslySetInnerHTML={{ __html: cred.data.svg }} aria-label="Mi credencial QR" />
        )}
      </div>
      <p className="mt-2 font-mono text-xs text-slate-500">
        {segundos > 0 ? `válido ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")} · se renueva solo` : "renovando…"}
      </p>
      <p className="mt-2 text-xs text-slate-600">Muéstralo en el comedor, en el almacén para herramienta y materiales, y en el mostrador.</p>
    </section>
  );
}
