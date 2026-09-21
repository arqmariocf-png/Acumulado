import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { abrirParaImprimir, htmlAvisoPrivacidad, htmlContrato } from "../lib/documentosRh";
import type { Contratacion, EmpresaPerfilLegal, Personal } from "../types/database";

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

export function MisDocumentos() {
  const { perfil } = useAuth();
  const { data: persona, isLoading } = useMiPersonal(perfil?.id);
  const { data: contrataciones } = useMisContrataciones(persona?.id);
  const empresaIds = Array.from(new Set((contrataciones ?? []).map((c) => c.empresa_id)));
  const { data: perfiles } = usePerfilesLegales(empresaIds);
  const [aviso, setAviso] = useState<string | null>(null);

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
