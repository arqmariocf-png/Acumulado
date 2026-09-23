import { fechaCorta } from "./comun";
import type { PuAprobacion, PuEstado } from "../../types/database";

// Quién ya firmó y quién falta, como gráfica. Vive sólo en la pantalla: el PDF
// se le entrega al cliente y el circuito de autorización es gobierno interno
// de Grupo Loma, no información del entregable.

const ETAPAS: { estado: PuEstado; titulo: string; area: string }[] = [
  { estado: "en_revision_material", titulo: "Elaboró", area: "Supervisión" },
  { estado: "material_confirmado", titulo: "Confirmó material", area: "Almacén" },
  { estado: "autorizado", titulo: "Autorizó", area: "Dirección" },
  { estado: "publicado", titulo: "Publicó", area: "Dirección general" },
];

export function CircuitoFirmas({
  estado,
  bitacora,
  elaboradoPor,
}: {
  estado: PuEstado;
  bitacora: PuAprobacion[];
  elaboradoPor: string | null;
}) {
  // Un rechazo borra el avance: las firmas anteriores ya no sostienen esta
  // versión del análisis, porque después de regresarlo a borrador las
  // cantidades pudieron cambiar. Sólo cuentan las firmas posteriores al último
  // regreso a borrador.
  const enOrden = [...bitacora].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ultimoRechazo = enOrden.map((b) => b.estado_nuevo).lastIndexOf("borrador");
  const vigentes = ultimoRechazo === -1 ? enOrden : enOrden.slice(ultimoRechazo + 1);

  const firmaDe = (e: PuEstado) => [...vigentes].reverse().find((b) => b.estado_nuevo === e);

  const indiceActual = ETAPAS.findIndex((e) => e.estado === estado);
  // estado 'borrador' no está en ETAPAS: el circuito no ha empezado.
  const firmadasHasta = estado === "obsoleto" ? ETAPAS.length : indiceActual;

  const huboRechazo = ultimoRechazo !== -1 && estado === "borrador";

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-sm font-medium text-slate-900">Autorizaciones</p>
        <p className="text-xs text-slate-500">
          {estado === "publicado"
            ? "Circuito completo"
            : `Faltan ${ETAPAS.length - firmadasHasta - 1} de ${ETAPAS.length}`}
        </p>
      </div>

      <ol className="grid grid-cols-4 gap-1">
        {ETAPAS.map((etapa, i) => {
          const firma = firmaDe(etapa.estado);
          const firmada = !!firma || i <= firmadasHasta;
          const esActual = i === firmadasHasta + 1 && estado !== "publicado" && estado !== "obsoleto";

          return (
            <li key={etapa.estado} className="flex flex-col items-center text-center">
                <div className="flex w-full items-center">
                  {/* Los tramos de línea van entre círculos, no antes del
                      primero ni después del último. */}
                  <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : firmada ? "bg-emerald-500" : "bg-slate-200"}`} />
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                      firmada
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : esActual
                          ? "border-amber-500 bg-white text-amber-600"
                          : "border-slate-200 bg-white text-slate-300"
                    }`}
                  >
                    {firmada ? "✓" : i + 1}
                  </span>
                  <span
                    className={`h-0.5 flex-1 ${
                      i === ETAPAS.length - 1 ? "bg-transparent" : i < firmadasHasta ? "bg-emerald-500" : "bg-slate-200"
                    }`}
                  />
                </div>

                <p className={`mt-2 text-xs font-medium ${firmada || esActual ? "text-slate-900" : "text-slate-400"}`}>
                  {etapa.titulo}
                </p>
                <p className="text-[11px] leading-tight text-slate-400">{etapa.area}</p>

                <p className="mt-1 text-[11px] leading-tight text-slate-500">
                  {firma ? (
                    <>
                      {firma.actor_nombre ?? "—"}
                      <span className="block text-slate-400">{fechaCorta(firma.created_at)}</span>
                    </>
                  ) : i === 0 && elaboradoPor ? (
                    <>
                      {elaboradoPor}
                      <span className="block text-slate-400">sin enviar</span>
                    </>
                  ) : esActual ? (
                    <span className="text-amber-600">En espera</span>
                  ) : (
                    ""
                  )}
                </p>
            </li>
          );
        })}
      </ol>

      {huboRechazo && (
        <p className="mt-4 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Este análisis se regresó a borrador, así que las firmas anteriores ya no cuentan: al reenviarlo, el circuito
          vuelve a empezar.
        </p>
      )}
    </section>
  );
}
