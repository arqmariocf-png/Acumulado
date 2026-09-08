import type { Tarjeta } from "../../types/database";
import { addDias, isoDia, semaforoFecha, COLOR_SEMAFORO, type Semaforo } from "./semaforo";

const DIAS_VENTANA = 14;
const DIA_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function CalendarioVencimientos({ tarjetas, onSeleccionar }: { tarjetas: Tarjeta[]; onSeleccionar: (id: string) => void }) {
  const conFecha = tarjetas.filter((t) => !!t.fecha_limite) as (Tarjeta & { fecha_limite: string })[];
  if (conFecha.length === 0) return null;

  const hoyDate = new Date();
  hoyDate.setHours(0, 0, 0, 0);
  const hoyIso = isoDia(hoyDate);

  const vencidas = conFecha.filter((t) => t.fecha_limite < hoyIso);
  const dias = Array.from({ length: DIAS_VENTANA }, (_, i) => addDias(hoyDate, i));

  return (
    <div className="mb-4 rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Vencimientos</h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {vencidas.length > 0 && <CeldaDia titulo="Vencidas" tarjetas={vencidas} tono="rojo" onSeleccionar={onSeleccionar} />}
        {dias.map((d) => {
          const iso = isoDia(d);
          const deEseDia = conFecha.filter((t) => t.fecha_limite === iso);
          return (
            <CeldaDia
              key={iso}
              titulo={`${d.getDate()} ${DIA_SEMANA[d.getDay()]}`}
              destacado={iso === hoyIso}
              tarjetas={deEseDia}
              tono={semaforoFecha(iso, hoyIso)}
              onSeleccionar={onSeleccionar}
            />
          );
        })}
      </div>
    </div>
  );
}

function CeldaDia({
  titulo,
  tarjetas,
  tono,
  destacado,
  onSeleccionar,
}: {
  titulo: string;
  tarjetas: Tarjeta[];
  tono: Semaforo;
  destacado?: boolean;
  onSeleccionar: (id: string) => void;
}) {
  const MOSTRAR = 2;
  return (
    <div className={`w-32 shrink-0 rounded border border-transparent p-1.5 ${COLOR_SEMAFORO[tono]} ${destacado ? "ring-1 ring-slate-900" : ""}`}>
      <p className="mb-1 text-[11px] font-medium text-slate-600">{titulo}</p>
      {tarjetas.slice(0, MOSTRAR).map((t) => (
        <button
          key={t.id}
          onClick={() => onSeleccionar(t.id)}
          title={t.titulo}
          className="mb-1 block w-full truncate rounded bg-white/70 px-1 py-0.5 text-left text-[11px] text-slate-700 hover:bg-white"
        >
          {t.titulo}
        </button>
      ))}
      {tarjetas.length > MOSTRAR && <p className="text-[11px] text-slate-500">+{tarjetas.length - MOSTRAR} más</p>}
    </div>
  );
}
