import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { htmlAvisoPrivacidad, htmlContrato, htmlConvenioConfidencialidad } from "../lib/documentosRh";
import { abrirParaImprimir } from "../lib/imprimir";
import { FirmaCanvas } from "../components/FirmaCanvas";
import type { Contratacion, EmpresaPerfilLegal, Personal, SolicitudFirma } from "../types/database";

/** La persona de RH ligada a la cuenta que está entrando (personal.profile_id).
 * RLS solo deja ver el propio renglón, sus contrataciones y el perfil legal
 * de las empresas que la contrataron (migración finiquito_y_documentos_propios). */
export function useMiPersonal(profileId: string | undefined) {
  return useQuery({
    queryKey: ["mi-personal", profileId],
    enabled: !!profileId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("personal").select("*").eq("profile_id", profileId!).maybeSingle();
      if (error) throw error;
      return (data as Personal | null) ?? null;
    },
  });
}

function useMisContrataciones(personalId: string | undefined) {
  return useQuery({
    queryKey: ["mis-contrataciones", personalId],
    enabled: !!personalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contrataciones")
        .select("*, empresa:empresa_id(nombre)")
        .eq("personal_id", personalId!)
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return data as (Contratacion & { empresa: { nombre: string } | null })[];
    },
  });
}

function usePerfilesLegales(empresaIds: string[]) {
  return useQuery({
    queryKey: ["perfil-legal", empresaIds],
    enabled: empresaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas_perfil_legal").select("*").in("empresa_id", empresaIds);
      if (error) throw error;
      return data as EmpresaPerfilLegal[];
    },
  });
}

/** Perfil legal de la empresa, o uno mínimo con el nombre comercial cuando
 * Admin todavía no captura los datos notariales. */
export function patronDe(perfiles: EmpresaPerfilLegal[] | undefined, empresaId: string, nombreEmpresa: string | null) {
  const pl = perfiles?.find((p) => p.empresa_id === empresaId);
  if (pl) return pl;
  return {
    razon_social: nombreEmpresa ?? "La empresa",
    representante_legal_nombre: "________________________",
    representante_legal_puesto: "Representante legal",
    domicilio_legal: "________________________",
    ciudad_firma: "Puebla, Pue.",
  };
}

const ETIQUETA_TIPO: Record<Contratacion["tipo_contrato"], string> = {
  laboral_determinado: "Contrato individual de trabajo (tiempo determinado)",
  laboral_indeterminado: "Contrato individual de trabajo (tiempo indeterminado)",
  prestacion_servicios: "Contrato de prestación de servicios",
  confidencialidad: "Convenio de confidencialidad",
};

function useMisSolicitudes(personalId: string | undefined) {
  return useQuery({
    queryKey: ["mis-solicitudes-firma", personalId],
    enabled: !!personalId,
    queryFn: async () => {
      const { data, error } = await supabase.from("solicitudes_firma").select("*, empresa:empresa_id(nombre)").eq("personal_id", personalId!).neq("estatus", "cancelado").order("created_at", { ascending: false });
      if (error) throw error;
      return data as (SolicitudFirma & { empresa: { nombre: string } | null })[];
    },
  });
}

/** Lectura y firma de un documento solicitado por RH: se muestra el texto
 * completo, se dibuja la firma y se acepta expresamente. */
function FirmarSolicitud({ solicitud, persona, patron, onFirmado }: { solicitud: SolicitudFirma; persona: Personal; patron: ReturnType<typeof patronDe>; onFirmado: () => void }) {
  const [firma, setFirma] = useState<string | null>(null);
  const [nombre, setNombre] = useState(persona.nombre);
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const html = htmlConvenioConfidencialidad(persona, patron, solicitud.puesto, solicitud.fecha_convenio, null);

  const firmar = useMutation({
    mutationFn: async () => {
      if (!firma) throw new Error("Dibuja tu firma.");
      if (!acepta) throw new Error("Marca que leíste y aceptas el convenio.");
      const { error: err } = await supabase.rpc("firmar_solicitud", { p_id: solicitud.id, p_nombre: nombre.trim(), p_firma_imagen: firma, p_dispositivo: navigator.userAgent.slice(0, 200) });
      if (err) throw err;
    },
    onSuccess: onFirmado,
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div className="mt-3 space-y-3 rounded border border-amber-200 bg-amber-50 p-3">
      {solicitud.mensaje && <p className="text-sm text-amber-900">Mensaje de RH: {solicitud.mensaje}</p>}
      <iframe title="Convenio" srcDoc={html.replace(/<button class="boton"[^>]*>.*?<\/button>/, "")} className="h-80 w-full rounded border border-slate-300 bg-white" />
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Tu firma</label>
        <FirmaCanvas onCambio={setFirma} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-700">Nombre completo</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-1" />
        <span>Leí el convenio completo y lo acepto. Entiendo que esta firma electrónica tiene el mismo valor que mi firma autógrafa y que queda registrada con fecha, hora y dispositivo.</span>
      </label>
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button onClick={() => firmar.mutate()} disabled={firmar.isPending || !firma || !acepta} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {firmar.isPending ? "Firmando…" : "Firmar convenio"}
      </button>
    </div>
  );
}

export function MisDocumentos() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: persona, isLoading } = useMiPersonal(perfil?.id);
  const { data: contrataciones } = useMisContrataciones(persona?.id);
  const { data: solicitudes } = useMisSolicitudes(persona?.id);
  const empresaIds = Array.from(new Set([...(contrataciones ?? []).map((c) => c.empresa_id), ...(solicitudes ?? []).map((s) => s.empresa_id)]));
  const { data: perfiles } = usePerfilesLegales(empresaIds);
  const [aviso, setAviso] = useState<string | null>(null);
  const [firmando, setFirmando] = useState<string | null>(null);

  function abrir(html: string) {
    setAviso(abrirParaImprimir(html) ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio e inténtalo de nuevo.");
  }

  if (isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;
  if (!persona) {
    return (
      <div className="max-w-xl rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Tu cuenta todavía no está ligada a un expediente de personal. Pídele a Recursos Humanos que la vincule para ver aquí tu contrato y el
        aviso de privacidad.
      </div>
    );
  }

  const vigentes = (contrataciones ?? []).filter((c) => c.estatus === "vigente");
  const lista = vigentes.length > 0 ? vigentes : (contrataciones ?? []).slice(0, 1);
  const patronAviso = lista[0] ? patronDe(perfiles, lista[0].empresa_id, lista[0].empresa?.nombre ?? null) : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Mis documentos</h1>
        <p className="text-sm text-slate-500">
          {persona.nombre}
          {persona.puesto ? ` · ${persona.puesto}` : ""} · ingreso {persona.fecha_ingreso}
        </p>
      </div>

      {aviso && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      {solicitudes && solicitudes.length > 0 && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Documentos por firmar</h2>
          <ul className="space-y-2">
            {solicitudes.map((s) => {
              const patron = patronDe(perfiles, s.empresa_id, s.empresa?.nombre ?? null);
              return (
                <li key={s.id} className="text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-slate-800">Convenio de confidencialidad</span>
                      <span className="text-slate-500"> · {s.empresa?.nombre ?? "empresa"} · solicitado el {new Date(s.solicitado_en).toLocaleDateString("es-MX")}</span>
                      {s.estatus === "firmado" && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">Firmado {s.firmado_en ? new Date(s.firmado_en).toLocaleDateString("es-MX") : ""}</span>}
                      {s.estatus === "pendiente" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Pendiente de tu firma</span>}
                    </span>
                    {s.estatus === "firmado" ? (
                      <button
                        type="button"
                        onClick={() => abrir(htmlConvenioConfidencialidad(persona, patron, s.puesto, s.fecha_convenio, s.firma_imagen && s.firmado_en ? { nombre: s.firma_nombre ?? persona.nombre, imagen: s.firma_imagen, firmado_en: s.firmado_en, dispositivo: s.firma_dispositivo } : null))}
                        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Ver / imprimir
                      </button>
                    ) : (
                      <button type="button" onClick={() => setFirmando((f) => (f === s.id ? null : s.id))} className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white">
                        {firmando === s.id ? "Cerrar" : "Leer y firmar"}
                      </button>
                    )}
                  </div>
                  {firmando === s.id && s.estatus === "pendiente" && (
                    <FirmarSolicitud
                      solicitud={s}
                      persona={persona}
                      patron={patron}
                      onFirmado={() => {
                        setFirmando(null);
                        setAviso("Convenio firmado. Ya puedes verlo o imprimirlo desde aquí.");
                        queryClient.invalidateQueries({ queryKey: ["mis-solicitudes-firma", persona.id] });
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Mi contrato</h2>
        {lista.length === 0 ? (
          <p className="text-sm text-slate-500">Recursos Humanos todavía no registra tu contratación.</p>
        ) : (
          <ul className="space-y-2">
            {lista.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-slate-800">{ETIQUETA_TIPO[c.tipo_contrato]}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {c.empresa?.nombre ?? "empresa"} · {c.puesto} · del {c.fecha_inicio} al {c.fecha_fin}
                    {c.estatus !== "vigente" ? ` (${c.estatus})` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => abrir(htmlContrato(persona, c, patronDe(perfiles, c.empresa_id, c.empresa?.nombre ?? null)))}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Ver / imprimir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Aviso de privacidad</h2>
        <p className="mb-3 text-sm text-slate-500">
          Cómo {patronAviso?.razon_social ?? "tu empresa"} trata tus datos personales (Ley Federal de Protección de Datos Personales en
          Posesión de los Particulares) y cómo ejercer tus derechos ARCO.
        </p>
        <button
          type="button"
          disabled={!patronAviso}
          onClick={() => patronAviso && abrir(htmlAvisoPrivacidad(patronAviso, persona))}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Ver / imprimir
        </button>
        {!patronAviso && <p className="mt-2 text-xs text-slate-400">Se habilita cuando RH registre tu contratación.</p>}
      </section>
    </div>
  );
}
