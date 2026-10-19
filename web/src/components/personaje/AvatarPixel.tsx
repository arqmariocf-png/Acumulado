/** Retrato del personaje (realista en JPEG o pixel-art en PNG) sobre el
 * color de su clase; sin avatar, sus iniciales. */
export function AvatarPixel({ avatar, nombre, color = "#475569", tamano = 64, nivel }: { avatar: string | null | undefined; nombre: string; color?: string; tamano?: number; nivel?: number }) {
  const iniciales = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className="relative inline-block shrink-0" style={{ width: tamano, height: tamano }}>
      <span
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border-2 border-slate-900/80 shadow-[2px_2px_0_rgba(15,23,42,0.6)]"
        style={{ background: `linear-gradient(160deg, ${color}, ${color}cc)` }}
      >
        {avatar ? (
          <img
            src={avatar}
            alt={nombre}
            className="h-full w-full object-cover"
            style={{ imageRendering: avatar.startsWith("data:image/png") ? "pixelated" : "auto" }}
          />
        ) : (
          <span className="font-mono font-bold text-white" style={{ fontSize: tamano * 0.36 }}>
            {iniciales || "?"}
          </span>
        )}
      </span>
      {nivel != null && (
        <span
          className="absolute -bottom-1.5 -right-1.5 rounded border-2 border-slate-900 bg-amber-300 px-1 font-mono font-bold leading-none text-slate-900"
          style={{ fontSize: Math.max(9, tamano * 0.2) }}
          title={`Nivel ${nivel}`}
        >
          {nivel}
        </span>
      )}
    </span>
  );
}
