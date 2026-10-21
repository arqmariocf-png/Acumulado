import { partirEnlaces } from "../lib/enlaces";

// Pinta un texto con sus ligas clicables (abren en otra pestaña).
export function TextoConEnlaces({ texto }: { texto: string | null | undefined }) {
  return (
    <>
      {partirEnlaces(texto).map((p, i) =>
        p.tipo === "liga" ? (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline hover:text-sky-900" onClick={(e) => e.stopPropagation()}>
            {p.texto}
          </a>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </>
  );
}
