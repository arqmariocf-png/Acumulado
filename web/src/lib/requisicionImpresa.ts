// Requisición imprimible (Mario, 15-oct-2026: "un descargable en PDF para que
// puedan imprimirlo los chavos y también en almacén para revisar entregas
// físicas"). Dos formatos con los mismos datos:
//   - "requisicion": lo que se pidió, para la cuadrilla (vertical).
//   - "entrega": hoja de almacén para revisar físicamente cada partida
//     (horizontal): lo que va en bodega, enviado y recibido en obra según el
//     seguimiento, y columnas en blanco para contar y firmar.
// HTML sin DOM: se compila también para las pruebas de node y la pantalla lo
// abre con lib/imprimir.ts (el navegador lo guarda como PDF).

export type ModoRequisicionImpresa = "requisicion" | "entrega";

export interface RequisicionDoc {
  folio: number | string;
  fecha: string | null;
  empresa_nombre: string;
  empresa_rfc: string | null;
  proyecto: string | null;
  solicitante: string | null;
  estado: string | null;
  comentario: string | null;
  /** Fecha y hora de impresión ya formateada (hora de México). */
  impreso: string;
}

export interface LineaRequisicionDoc {
  descripcion: string;
  unidad: string;
  solicitado: number;
  /** Del seguimiento por renglón (lib/seguimientoLinea.ts). */
  pedido?: number;
  enBodega?: number;
  enCamino?: number;
  enObra?: number;
  porEntregar?: number;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function cant(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (Math.abs(n) < 0.0005) return "0";
  return Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 });
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function tituloRequisicion(folio: number | string, modo: ModoRequisicionImpresa): string {
  return modo === "entrega" ? `Hoja de entrega requisición ${folio}` : `Requisición ${folio}`;
}

export function htmlRequisicion(doc: RequisicionDoc, lineas: LineaRequisicionDoc[], modo: ModoRequisicionImpresa, logoUrl: string | null): string {
  const entrega = modo === "entrega";
  const filas = lineas
    .map((l, i) =>
      entrega
        ? `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.descripcion)}</td>
        <td class="c">${esc(l.unidad)}</td>
        <td class="r">${esc(cant(l.solicitado))}</td>
        <td class="r">${esc(cant(l.enBodega))}</td>
        <td class="r">${esc(cant(l.enCamino))}</td>
        <td class="r">${esc(cant(l.enObra))}</td>
        <td class="r b">${esc(cant(l.porEntregar))}</td>
        <td class="blank"></td>
        <td class="c"><span class="caja"></span></td>
        <td class="blank obsv"></td>
      </tr>`
        : `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.descripcion)}</td>
        <td class="c">${esc(l.unidad)}</td>
        <td class="r b">${esc(cant(l.solicitado))}</td>
        <td class="c"><span class="caja"></span></td>
        <td class="blank obsv"></td>
      </tr>`,
    )
    .join("");
  const encabezados = entrega
    ? `<th class="c" style="width:26px">#</th><th>Concepto</th><th class="c" style="width:50px">Unidad</th><th class="r" style="width:62px">Solicitado</th><th class="r" style="width:62px">En bodega</th><th class="r" style="width:62px">En camino a obra</th><th class="r" style="width:62px">Recibido en obra</th><th class="r" style="width:62px">Por entregar</th><th class="c" style="width:70px">Entregado hoy</th><th class="c" style="width:34px">OK</th><th style="width:150px">Observaciones</th>`
    : `<th class="c" style="width:28px">#</th><th>Concepto</th><th class="c" style="width:60px">Unidad</th><th class="r" style="width:75px">Cantidad</th><th class="c" style="width:56px">Recibido</th><th style="width:170px">Observaciones</th>`;
  const columnas = entrega ? 11 : 6;
  const firmas = entrega ? ["Entrega (almacén)", "Transporta", "Recibe en obra"] : ["Solicitó", "Vo. Bo. (responsable de obra)", "Almacén"];
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(tituloRequisicion(doc.folio, modo))}</title>
<style>
  @page { size: letter ${entrega ? "landscape" : "portrait"}; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; margin: 0; }
  .hoja { max-width: ${entrega ? "255mm" : "190mm"}; margin: 0 auto; padding: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .cab img { max-height: 48px; max-width: 160px; display: block; margin-bottom: 6px; }
  .cab h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: .5px; }
  .cab .emp { font-size: 13px; font-weight: bold; }
  .sub { color: #555; }
  .folio { text-align: right; }
  .folio .num { font-size: 24px; font-weight: bold; font-family: "Courier New", monospace; }
  .datos { display: grid; grid-template-columns: 1fr 1fr${entrega ? " 1fr" : ""}; gap: 6px 20px; margin: 12px 0; }
  .datos div span { display: block; font-size: 10px; text-transform: uppercase; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
  td { overflow-wrap: anywhere; }
  th, td { border: 1px solid #999; padding: 6px 7px; vertical-align: top; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; text-align: left; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; }
  td.r { white-space: nowrap; }
  td.b { font-weight: bold; }
  td.blank { height: 22px; }
  .caja { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #111; }
  .obs { margin-top: 10px; }
  .lineas-obs { border-bottom: 1px solid #999; height: 22px; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 44px; page-break-inside: avoid; }
  .firmas div { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; }
  .pie { margin-top: 14px; font-size: 10px; color: #777; }
  .btn { position: fixed; bottom: 14px; right: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.25); padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } }
</style></head>
<body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="cab">
    <div>
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" onerror="this.style.display='none'">` : ""}
      <h1>${entrega ? "HOJA DE ENTREGA DE MATERIAL" : "REQUISICIÓN DE MATERIAL"}</h1>
      <div class="emp">${esc(doc.empresa_nombre)}</div>
      <div class="sub">${doc.empresa_rfc ? `RFC ${esc(doc.empresa_rfc)}` : ""}</div>
    </div>
    <div class="folio">
      <div class="sub">Requisición</div>
      <div class="num">#${esc(doc.folio)}</div>
      <div class="sub">${esc(fechaLarga(doc.fecha))}</div>
    </div>
  </div>
  <div class="datos">
    <div><span>Obra / proyecto</span>${esc(doc.proyecto) || "—"}</div>
    <div><span>Solicitó</span>${esc(doc.solicitante) || "—"}</div>
    ${entrega ? `<div><span>Fecha de entrega</span>____ / ____ / ________</div>` : ""}
    <div><span>Estado</span>${esc(doc.estado) || "—"}</div>
    <div><span>Partidas</span>${lineas.length}</div>
    ${entrega ? `<div><span>Lugar de entrega</span>&nbsp;</div>` : ""}
  </div>
  ${doc.comentario ? `<div class="obs"><strong>Comentario de quien pidió:</strong> ${esc(doc.comentario)}</div>` : ""}
  <table>
    <thead><tr>${encabezados}</tr></thead>
    <tbody>${filas || `<tr><td colspan="${columnas}" class="c sub">Sin renglones.</td></tr>`}</tbody>
  </table>
  ${entrega ? `<p class="pie">En bodega, en camino y recibido en obra según lo registrado en Acumulado al ${esc(doc.impreso)}. "Entregado hoy" y "OK" se llenan al revisar físicamente; después se registra en la requisición.</p>` : ""}
  <div class="obs"><strong>Observaciones:</strong><div class="lineas-obs"></div><div class="lineas-obs"></div></div>
  <div class="firmas">${firmas.map((f) => `<div>${esc(f)}<br><br>Nombre y firma</div>`).join("")}</div>
  <p class="pie">Impreso ${esc(doc.impreso)} · Acumulado</p>
</div>
</body></html>`;
}
