import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import {
  VERSION_DOCUMENTOS,
  amortizar,
  documentoAfiliacion,
  documentoConsentimiento,
  documentoPagare,
  htmlDocumentoFirmado,
  type DatosAfiliacion,
  type Documento,
  type FirmaGuardada,
  type ParteDocumento,
} from "../../lib/creditoNomina";
import { FirmaDigital } from "../FirmaDigital";

const dinero = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

interface DatosDocumentos {
  trabajador: string;
  puesto: string | null;
  patron: ParteDocumento | null;
  financiera: ParteDocumento | null;
  ciudad: string;
  cargo: null | {
    id: string;
    concepto: string;
    monto: number;
    pagos: number;
    tasa_anual: number;
    iva_intereses: number;
    tasa_moratoria_anual: number;
    primer_descuento: string;
    total: number;
    descuento_por_pago: number;
    acreedor: ParteDocumento | null;
  };
}

interface Firma extends FirmaGuardada {
  id: string;
  tipo: "afiliacion" | "consentimiento" | "pagare";
  cargo_id: string | null;
}

function hoyMexico(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

async function datosDocumentos(cargo?: string): Promise<DatosDocumentos> {
  const { data, error } = await supabase.rpc("fn_credito_datos_documentos", { p_cargo: cargo ?? null });
  if (error) throw error;
  return data as DatosDocumentos;
}

function base(d: DatosDocumentos): DatosAfiliacion {
  return {
    trabajador: d.trabajador,
    puesto: d.puesto,
    patron: d.patron ?? { razon_social: "la empresa" },
    financiera: d.financiera,
    ciudad: d.ciudad,
    fecha: hoyMexico(),
  };
}

function useMisFirmas() {
  const { perfilReal } = useAuth();
  return useQuery({
    queryKey: ["mis-firmas-credito", perfilReal?.id],
    enabled: !!perfilReal?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credito_firmas")
        .select("id, tipo, titulo, contenido, firma, hash, firmante_nombre, firmado_en, ip, version, cargo_id, revocada_en, revocada_motivo")
        .eq("profile_id", perfilReal!.id)
        .order("firmado_en", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Firma[];
    },
  });
}

/** Afiliación, consentimiento y pagarés del trabajador, firmados en su app. */
export function DocumentosCredito() {
  const { perfilReal, soloConsulta } = useAuth();
  const firmas = useMisFirmas();
  const porFirmar = useQuery({
    queryKey: ["mis-pagares-por-firmar", perfilReal?.id],
    enabled: !!perfilReal?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_nomina_cargos")
        .select("id, concepto, monto, total, pagos, descuento_por_pago, tasa_anual")
        .eq("profile_id", perfilReal!.id)
        .eq("estatus", "por_firmar")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as { id: string; concepto: string; monto: number; total: number; pagos: number; descuento_por_pago: number; tasa_anual: number }[];
    },
  });
  const [abierto, setAbierto] = useState<null | { tipo: "afiliacion" } | { tipo: "pagare"; cargo: string }>(null);
  const vigentes = (firmas.data ?? []).filter((f) => !f.revocada_en);
  const tiene = (t: string) => vigentes.some((f) => f.tipo === t);
  const afiliado = tiene("afiliacion") && tiene("consentimiento");
  if (!perfilReal) return null;

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <h2 className="font-semibold text-slate-800">✍️ Mis documentos de crédito</h2>
      {!afiliado && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2">
          <p>Para usar tu cuenta de nómina primero firma tu <b>afiliación</b> y tu <b>consentimiento de descuento</b>. Se firman aquí, con tu dedo.</p>
          {!soloConsulta && (
            <button type="button" className="mt-2 rounded bg-slate-900 px-3 py-1.5 font-medium text-white" onClick={() => setAbierto({ tipo: "afiliacion" })}>
              Leer y firmar
            </button>
          )}
        </div>
      )}
      {(porFirmar.data ?? []).map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky-300 bg-sky-50 p-2">
          <span>
            Pagaré por firmar: <b>{c.concepto}</b> · {dinero(c.total)} en {c.pagos} pago(s) de {dinero(c.descuento_por_pago)}
            {c.tasa_anual > 0 ? ` · ${c.tasa_anual} % anual` : " · sin intereses"}
          </span>
          {!soloConsulta && (
            <button type="button" className="rounded bg-sky-700 px-3 py-1.5 font-medium text-white" onClick={() => setAbierto({ tipo: "pagare", cargo: c.id })}>
              Revisar y firmar
            </button>
          )}
        </div>
      ))}
      {abierto && <Firmar pedido={abierto} faltan={abierto.tipo === "afiliacion" ? (["afiliacion", "consentimiento"] as const).filter((t) => !tiene(t)) : ["pagare"]} alTerminar={() => setAbierto(null)} />}
      {(firmas.data ?? []).length > 0 && (
        <ul className="divide-y divide-slate-100">
          {(firmas.data ?? []).map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-1">
              <span className={f.revocada_en ? "text-slate-400 line-through" : ""}>
                {f.titulo} <span className="text-xs text-slate-500">· {new Date(f.firmado_en).toLocaleDateString("es-MX")}</span>
              </span>
              <button type="button" className="text-xs text-sky-700 underline" onClick={() => abrirParaImprimir(htmlDocumentoFirmado(f))}>
                ver / imprimir
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Firmar({
  pedido,
  faltan,
  alTerminar,
}: {
  pedido: { tipo: "afiliacion" } | { tipo: "pagare"; cargo: string };
  faltan: readonly ("afiliacion" | "consentimiento" | "pagare")[];
  alTerminar: () => void;
}) {
  const qc = useQueryClient();
  const { perfilReal } = useAuth();
  const [acepto, setAcepto] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const cargo = pedido.tipo === "pagare" ? pedido.cargo : undefined;
  const datos = useQuery({ queryKey: ["datos-documentos-credito", cargo ?? "afiliacion"], queryFn: () => datosDocumentos(cargo) });

  const documentos: Documento[] = [];
  if (datos.data) {
    const b = base(datos.data);
    if (faltan.includes("afiliacion")) documentos.push(documentoAfiliacion(b));
    if (faltan.includes("consentimiento")) documentos.push(documentoConsentimiento(b));
    const c = datos.data.cargo;
    if (pedido.tipo === "pagare" && c) {
      const a = amortizar(Number(c.monto), Number(c.tasa_anual), Number(c.iva_intereses), c.pagos, c.primer_descuento);
      documentos.push(
        documentoPagare({ ...b, acreedor: c.acreedor ?? b.patron, concepto: c.concepto, amortizacion: a, tasaMoratoria: Number(c.tasa_moratoria_anual) }),
      );
    }
  }

  const firmar = useMutation({
    mutationFn: async () => {
      if (!firma) throw new Error("Falta tu firma.");
      for (const d of documentos) {
        const { error } = await supabase.rpc("fn_credito_firmar", {
          p_tipo: d.tipo,
          p_version: VERSION_DOCUMENTOS,
          p_titulo: d.titulo,
          p_contenido: d.texto,
          p_firma: firma,
          p_cargo: d.tipo === "pagare" ? cargo : null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      for (const k of ["mis-firmas-credito", "mis-pagares-por-firmar", "mi-cuenta-nomina", "mis-cargos-nomina"]) void qc.invalidateQueries({ queryKey: [k, perfilReal?.id] });
      alTerminar();
    },
  });

  return (
    <div className="space-y-3 rounded border-2 border-slate-900 bg-slate-50 p-3">
      {datos.isLoading && <p className="text-slate-400">Preparando tus documentos…</p>}
      {datos.error && <p className="text-red-600">{(datos.error as Error).message}</p>}
      {documentos.map((d) => (
        <div key={d.tipo} className="max-h-72 overflow-y-auto rounded border border-slate-300 bg-white p-3 font-serif text-[13px] leading-relaxed text-slate-800">
          {d.texto.split(/\n{2,}/).map((p, k) => (
            <p key={k} className={k === 0 ? "mb-2 text-center font-bold" : "mb-2 whitespace-pre-line"}>
              {p}
            </p>
          ))}
        </div>
      ))}
      {documentos.length > 0 && (
        <>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
            <span>
              Leí {documentos.length > 1 ? "los documentos" : "el documento"} y estoy de acuerdo. Mi firma de abajo vale para {documentos.length > 1 ? "cada uno" : "él"}.
            </span>
          </label>
          <FirmaDigital onCambio={setFirma} />
          <div className="flex gap-2">
            <button type="button" disabled={!acepto || !firma || firmar.isPending} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={() => firmar.mutate()}>
              {firmar.isPending ? "Firmando…" : "Firmar"}
            </button>
            <button type="button" className="rounded border border-slate-300 px-3 py-2" onClick={alTerminar}>
              Ahora no
            </button>
          </div>
          {firmar.error && <p className="text-red-600">{(firmar.error as Error).message}</p>}
          <p className="text-xs text-slate-500">
            Se guarda el texto tal cual lo leíste, tu firma, la fecha y hora, y una huella digital del documento. Puedes verlos e imprimirlos aquí mismo cuando quieras.
          </p>
        </>
      )}
    </div>
  );
}
