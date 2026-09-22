import { useState } from "react";

// Gráficas SVG del panel de RH, sin librería. Colores por rol (no por
// serie arbitraria): categóricos slot 1/2 para altas/bajas, estatus fijo
// para cumplimiento (bueno / advertencia / crítico) más neutro.
export const COLOR = {
  serie1: "#2a78d6",
  serie2: "#eb6834",
  bueno: "#0ca30c",
  advertencia: "#fab219",
  critico: "#d03b3b",
  neutro: "#a3a3a0",
  texto: "#0b0b0b",
  textoSec: "#52514e",
  grid: "#e7e6e2",
};

export interface Segmento {
  clave: string;
  etiqueta: string;
  valor: number;
  color: string;
}

export interface BarraApilada {
  etiqueta: string;
  segmentos: Segmento[];
}

/** Barras apiladas verticales (una por periodo) con leyenda, tooltip por
 * segmento y vista de tabla. */
export function GraficaApilada({ barras, titulo, alto = 180 }: { barras: BarraApilada[]; titulo: string; alto?: number }) {
  const [tabla, setTabla] = useState(false);
  const [hover, setHover] = useState<{ b: number; s: number } | null>(null);
  const series = barras[0]?.segmentos.map((s) => ({ clave: s.clave, etiqueta: s.etiqueta, color: s.color })) ?? [];
  const maximo = Math.max(1, ...barras.map((b) => b.segmentos.reduce((s, x) => s + x.valor, 0)));
  const ancho = 640;
  const margen = { izq: 28, der: 8, arr: 8, abajo: 26 };
  const anchoPlot = ancho - margen.izq - margen.der;
  const altoPlot = alto - margen.arr - margen.abajo;
  const paso = anchoPlot / Math.max(1, barras.length);
  const anchoBarra = Math.min(36, paso * 0.6);
  const escala = (v: number) => (v / maximo) * altoPlot;
  const ticks = [0, Math.ceil(maximo / 2), maximo];

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-700">{titulo}</h4>
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <span key={s.clave} className="flex items-center gap-1 text-xs text-slate-600">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /> {s.etiqueta}
            </span>
          ))}
          <button onClick={() => setTabla((v) => !v)} className="text-xs text-slate-500 underline">
            {tabla ? "ver gráfica" : "ver tabla"}
          </button>
        </div>
      </div>
      {tabla ? (
        <table className="w-full text-xs">
          <thead className="text-left uppercase text-slate-500">
            <tr>
              <th className="py-1">Periodo</th>
              {series.map((s) => (
                <th key={s.clave} className="py-1 text-right">
                  {s.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {barras.map((b) => (
              <tr key={b.etiqueta} className="border-t border-slate-100">
                <td className="py-1">{b.etiqueta}</td>
                {b.segmentos.map((s) => (
                  <td key={s.clave} className="py-1 text-right tabular-nums">
                    {s.valor}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-auto w-full" role="img" aria-label={titulo}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margen.izq} x2={ancho - margen.der} y1={margen.arr + altoPlot - escala(t)} y2={margen.arr + altoPlot - escala(t)} stroke={COLOR.grid} strokeWidth={1} />
              <text x={margen.izq - 4} y={margen.arr + altoPlot - escala(t) + 3} fontSize={9} textAnchor="end" fill={COLOR.textoSec}>
                {t}
              </text>
            </g>
          ))}
          {barras.map((b, i) => {
            const x = margen.izq + paso * i + (paso - anchoBarra) / 2;
            let acumulado = 0;
            const total = b.segmentos.reduce((s, x) => s + x.valor, 0);
            return (
              <g key={b.etiqueta}>
                {b.segmentos.map((s, j) => {
                  const h = escala(s.valor);
                  const y = margen.arr + altoPlot - acumulado - h;
                  acumulado += h;
                  const activo = hover?.b === i && hover?.s === j;
                  return (
                    <rect
                      key={s.clave}
                      x={x}
                      y={y + (h > 2 ? 1 : 0)}
                      width={anchoBarra}
                      height={Math.max(0, h - (h > 2 ? 2 : 0))}
                      fill={s.color}
                      opacity={hover && !activo ? 0.6 : 1}
                      rx={j === b.segmentos.length - 1 ? 2 : 0}
                      onMouseEnter={() => setHover({ b: i, s: j })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{`${b.etiqueta} · ${s.etiqueta}: ${s.valor}`}</title>
                    </rect>
                  );
                })}
                {total > 0 && (
                  <text x={x + anchoBarra / 2} y={margen.arr + altoPlot - escala(total) - 3} fontSize={9} textAnchor="middle" fill={COLOR.texto}>
                    {total}
                  </text>
                )}
                <text x={x + anchoBarra / 2} y={alto - 8} fontSize={9} textAnchor="middle" fill={COLOR.textoSec}>
                  {b.etiqueta}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Barras horizontales de porcentaje (una por persona), con el número. */
export function BarrasPorcentaje({ filas, titulo }: { filas: { etiqueta: string; pct: number; detalle: string }[]; titulo: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">{titulo}</h4>
      {filas.length === 0 && <p className="text-xs text-slate-400">Sin actividades asignadas todavía.</p>}
      <ul className="space-y-1.5">
        {filas.map((f) => {
          const color = f.pct >= 80 ? COLOR.bueno : f.pct >= 50 ? COLOR.advertencia : COLOR.critico;
          return (
            <li key={f.etiqueta} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">{f.etiqueta}</span>
                <span className="tabular-nums text-slate-900">{f.pct}%</span>
              </div>
              <div className="mt-0.5 h-2 w-full rounded bg-slate-100" title={f.detalle}>
                <div className="h-2 rounded" style={{ width: `${Math.min(100, f.pct)}%`, background: color }} />
              </div>
              <div className="text-[10px] text-slate-400">{f.detalle}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
