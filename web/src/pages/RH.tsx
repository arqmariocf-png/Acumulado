import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { PestanaDocumentos } from "./rh/Expediente";
import { abrirParaImprimir, htmlFiniquito } from "../lib/documentosRh";
import { patronDe } from "./MisDocumentos";
import type {
  AsignacionDiaria,
  AsistenciaSemanalPersonal,
  Contratacion,
  EmpresaPerfilLegal,
  DirectorioPerfil,
  Personal,
  ProyeccionNominaSemanal,
  TipoContrato,
} from "../types/database";

type Pestana = "personal" | "asignaciones" | "contrataciones" | "documentos" | "nomina";

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "personal", etiqueta: "Personal" },
  { valor: "asignaciones", etiqueta: "Asignaciones diarias" },
  { valor: "contrataciones", etiqueta: "Contrataciones" },
  { valor: "documentos", etiqueta: "Documentos / Expediente" },
  { valor: "nomina", etiqueta: "Nómina y asistencia" },
];

function dinero(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

/** Lunes de la semana ISO que contiene `d`, en formato YYYY-MM-DD. */
function inicioDeSemana(d: Date): string {
  const copia = new Date(d);
  const diaSemana = (copia.getDay() + 6) % 7; // lunes = 0
  copia.setDate(copia.getDate() - diaSemana);
  copia.setHours(0, 0, 0, 0);
  return copia.toISOString().slice(0, 10);
}

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";

/** FormData trae "" para un campo vacío -- las columnas opcionales de
 * `personal` son NULL, no cadena vacía, así que se normaliza aquí en vez de
 * guardar strings vacíos que después se ven como "algo" en vez de "nada". */
function oVacio(fd: FormData, campo: string): string | null {
  const v = (fd.get(campo) as string | null)?.trim();
  return v ? v : null;
}

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string }[];
    },
  });
}

function usePersonal() {
  return useQuery({
    queryKey: ["rh-personal"],
    queryFn: async () => {
      const { data, error } = await supabase.from("personal").select("*").order("nombre");
      if (error) throw error;
      return data as Personal[];
    },
  });
}

export function RH() {
  const { perfil } = useAuth();
  // 'rh_documentos' (ej. Raúl) solo captura expedientes, bajo supervisión de
  // 'rh' (ej. Eréndira) -- no debe ver ni las otras pestañas (sueldos,
  // asignaciones diarias, datos de personal editables) aunque RLS ya se lo
  // bloquee del lado del dato, ver 20260828020000_rh_documentos_rol_enum.sql.
  const soloDocumentos = perfil?.rol === "rh_documentos";
  const pestanas = soloDocumentos ? PESTANAS.filter((p) => p.valor === "documentos") : PESTANAS;
  const [pestana, setPestana] = useState<Pestana>(soloDocumentos ? "documentos" : "personal");

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Recursos Humanos</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {pestanas.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPestana(p.valor)}
            className={`rounded px-3 py-1.5 text-sm ${pestana === p.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"} border border-slate-200`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === "personal" && <PestanaPersonal />}
      {pestana === "asignaciones" && <PestanaAsignaciones />}
      {pestana === "contrataciones" && <PestanaContrataciones />}
      {pestana === "documentos" && <PestanaDocumentos />}
      {pestana === "nomina" && <PestanaNomina />}
    </div>
  );
}

// ── Nómina y asistencia ──────────────────────────────────────────────────

function useDirectorio() {
  return useQuery({
    queryKey: ["directorio"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_directorio").select("*").eq("activo", true).order("nombre");
      if (error) throw error;
      return data as DirectorioPerfil[];
    },
  });
}

function useAsistenciaSemanal(semanaInicio: string) {
  return useQuery({
    queryKey: ["asistencia-semanal", semanaInicio],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_asistencia_semanal_personal").select("*").eq("semana_inicio", semanaInicio);
      if (error) throw error;
      return data as AsistenciaSemanalPersonal[];
    },
  });
}

function useProyeccionNomina() {
  return useQuery({
    queryKey: ["proyeccion-nomina"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_proyeccion_nomina_semanal").select("*").order("semana_inicio");
      if (error) throw error;
      return data as ProyeccionNominaSemanal[];
    },
  });
}

function PestanaNomina() {
  const { data: personal } = usePersonal();
  const { data: empresas } = useEmpresas();
  const { data: directorio } = useDirectorio();
  const queryClient = useQueryClient();
  const [semanaInicio, setSemanaInicio] = useState(inicioDeSemana(new Date()));
  const { data: asistencia, isLoading: cargandoAsistencia } = useAsistenciaSemanal(semanaInicio);
  const { data: proyeccion, isLoading: cargandoProyeccion } = useProyeccionNomina();
  const [error, setError] = useState<string | null>(null);

  const nombreEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.nombre]));

  const vincular = useMutation({
    mutationFn: async ({ personalId, profileId }: { personalId: string; profileId: string | null }) => {
      const { error: err } = await supabase.from("personal").update({ profile_id: profileId }).eq("id", personalId);
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rh-personal"] }),
    onError: (err) => setError((err as Error).message),
  });

  const personalActivo = (personal ?? []).filter((p) => p.activo);
  const pendientesDeVincular = personalActivo.filter((p) => !p.profile_id).length;

  return (
    <div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <p className="mb-4 max-w-2xl text-xs text-slate-500">
        El checador (entrada/salida) es una señal aparte de "Asignaciones diarias" -- todavía no se concilian automáticamente,
        compáralas a mano al armar la nómina real. El monto sugerido es el sueldo semanal completo de su contratación
        vigente; ajústalo por faltas o incidencias antes de pagar.
      </p>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        Vincular cuenta para poder checar {pendientesDeVincular > 0 && <span className="font-normal text-amber-600">({pendientesDeVincular} sin vincular)</span>}
      </h3>
      <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Cuenta vinculada</th>
            </tr>
          </thead>
          <tbody>
            {personalActivo.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="px-3 py-2">
                  <select
                    value={p.profile_id ?? ""}
                    onChange={(e) => vincular.mutate({ personalId: p.id, profileId: e.target.value || null })}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Sin vincular</option>
                    {directorio?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {personalActivo.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-slate-400">
                  Sin personal activo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700">Lista de nómina de la semana</h3>
        <input
          type="date"
          value={semanaInicio}
          onChange={(e) => setSemanaInicio(inicioDeSemana(new Date(e.target.value + "T00:00:00")))}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        />
      </div>
      {cargandoAsistencia && <p className="text-sm text-slate-500">Cargando…</p>}
      <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2 text-right">Días checados</th>
              <th className="px-3 py-2 text-right">Sueldo semanal (sugerido)</th>
            </tr>
          </thead>
          <tbody>
            {asistencia?.map((a) => (
              <tr key={`${a.personal_id}-${a.contratacion_id}`} className="border-t border-slate-100">
                <td className="px-3 py-2">{a.personal_nombre}</td>
                <td className="px-3 py-2 text-slate-500">{nombreEmpresa.get(a.empresa_id) ?? "—"}</td>
                <td className="px-3 py-2 text-right">{a.dias_checados}</td>
                <td className="px-3 py-2 text-right font-medium">{dinero(a.sueldo_semanal)}</td>
              </tr>
            ))}
            {asistencia?.length === 0 && !cargandoAsistencia && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                  Sin marcas de checador ligadas a nómina esta semana.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">Proyección de gasto de nómina (próximas 12 semanas)</h3>
      {cargandoProyeccion && <p className="text-sm text-slate-500">Cargando…</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Semana</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2 text-right">Monto proyectado</th>
            </tr>
          </thead>
          <tbody>
            {proyeccion?.map((p, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2">{new Date(p.semana_inicio + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className="px-3 py-2 text-slate-500">{nombreEmpresa.get(p.empresa_id) ?? "—"}</td>
                <td className="px-3 py-2 text-right font-medium">{dinero(p.monto_proyectado)}</td>
              </tr>
            ))}
            {proyeccion?.length === 0 && !cargandoProyeccion && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                  Sin contrataciones vigentes para proyectar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Personal ─────────────────────────────────────────────────────────────

function PestanaPersonal() {
  const { data: personal, isLoading } = usePersonal();
  const queryClient = useQueryClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("personal").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rh-personal"] });
      setMostrarForm(false);
    },
    onError: (err) => setError((err as Error).message),
  });

  // Baja / reactivación: el registro se conserva (expediente, asignaciones y
  // contrataciones históricas siguen ligadas); solo cambia activo + motivo.
  const [bajaDe, setBajaDe] = useState<Personal | null>(null);
  const [mostrarBajas, setMostrarBajas] = useState(false);
  const cambiarEstado = useMutation({
    mutationFn: async (p: { id: string; activo: boolean; fecha_baja: string | null; motivo_baja: string | null; finiquito_entregado_en?: null }) => {
      const { id, ...cambios } = p;
      const { data, error } = await supabase.from("personal").update(cambios).eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No se pudo actualizar (sin permiso o el registro ya no existe)");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rh-personal"] });
      queryClient.invalidateQueries({ queryKey: ["rh-documentos-faltantes"] });
      queryClient.invalidateQueries({ queryKey: ["rh-expediente"] });
      setBajaDe(null);
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmitBaja(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bajaDe) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const motivo = String(fd.get("motivo") ?? "otro");
    const nota = String(fd.get("nota") ?? "").trim();
    cambiarEstado.mutate({
      id: bajaDe.id,
      activo: false,
      fecha_baja: String(fd.get("fecha_baja") ?? hoyIso()),
      motivo_baja: nota ? `${motivo}: ${nota}` : motivo,
    });
  }

  const listado = (personal ?? []).filter((p) => mostrarBajas || p.activo);
  const bajas = (personal ?? []).filter((p) => !p.activo).length;

  // Carta finiquito: toda baja la necesita. Se genera desde aquí con la
  // última contratación (patrón, puesto, sueldo) y se marca cuando se entregó.
  const finiquitosPendientes = (personal ?? []).filter((p) => !p.activo && !p.finiquito_entregado_en);
  const { data: contratacionesTodas } = useContrataciones();
  const empresaIds = Array.from(new Set((contratacionesTodas ?? []).map((c) => c.empresa_id)));
  const { data: perfilesLegales } = useQuery({
    queryKey: ["perfil-legal", empresaIds],
    enabled: empresaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas_perfil_legal").select("*").in("empresa_id", empresaIds);
      if (error) throw error;
      return data as EmpresaPerfilLegal[];
    },
  });
  const [avisoVentana, setAvisoVentana] = useState<string | null>(null);
  function generarFiniquito(p: Personal) {
    const contratacion = (contratacionesTodas ?? []).find((c) => c.personal_id === p.id) ?? null; // ya vienen ordenadas por fecha_inicio desc
    const patron = contratacion
      ? patronDe(perfilesLegales, contratacion.empresa_id, contratacion.empresa?.nombre ?? null)
      : patronDe(undefined, "", null);
    const ok = abrirParaImprimir(htmlFiniquito(p, contratacion, patron));
    setAvisoVentana(ok ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio e inténtalo de nuevo.");
  }
  const marcarFiniquito = useMutation({
    mutationFn: async (p: { id: string; entregado: boolean }) => {
      const { data, error } = await supabase
        .from("personal")
        .update({ finiquito_entregado_en: p.entregado ? new Date().toISOString() : null })
        .eq("id", p.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No se pudo actualizar");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rh-personal"] }),
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      nombre: fd.get("nombre"),
      puesto: oVacio(fd, "puesto"),
      fecha_nacimiento: oVacio(fd, "fecha_nacimiento"),
      sexo: oVacio(fd, "sexo"),
      estado_civil: oVacio(fd, "estado_civil"),
      telefono: oVacio(fd, "telefono"),
      correo: oVacio(fd, "correo"),
      curp: oVacio(fd, "curp"),
      rfc: oVacio(fd, "rfc"),
      domicilio_particular: oVacio(fd, "domicilio_particular"),
      domicilio_notificaciones: oVacio(fd, "domicilio_notificaciones"),
      ine_numero_identificacion: oVacio(fd, "ine_numero_identificacion"),
      ine_clave_elector: oVacio(fd, "ine_clave_elector"),
      infonavit_tiene_credito: fd.get("infonavit_tiene_credito") === "on",
      infonavit_numero_credito: oVacio(fd, "infonavit_numero_credito"),
      contacto_emergencia_nombre: oVacio(fd, "contacto_emergencia_nombre"),
      contacto_emergencia_telefono: oVacio(fd, "contacto_emergencia_telefono"),
      contacto_emergencia_parentesco: oVacio(fd, "contacto_emergencia_parentesco"),
      beneficiario_nombre: oVacio(fd, "beneficiario_nombre"),
      beneficiario_parentesco: oVacio(fd, "beneficiario_parentesco"),
      fecha_ingreso: fd.get("fecha_ingreso"),
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">{personal?.length ?? 0} persona(s) registrada(s).</p>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {mostrarForm ? "Cancelar" : "+ Dar de alta"}
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={onSubmit} className="mb-6 max-w-3xl space-y-4 rounded border border-slate-200 bg-white p-4">
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700">Datos generales</legend>
            <div>
              <label className={etiquetaCampo}>Nombre completo *</label>
              <input name="nombre" required className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Puesto</label>
              <input name="puesto" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Fecha de ingreso (primera contratación) *</label>
              <input type="date" name="fecha_ingreso" required className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Fecha de nacimiento</label>
              <input type="date" name="fecha_nacimiento" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Sexo</label>
              <select name="sexo" className={campoTexto} defaultValue="">
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
            <div>
              <label className={etiquetaCampo}>Estado civil</label>
              <input name="estado_civil" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Teléfono</label>
              <input name="telefono" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Correo</label>
              <input type="email" name="correo" className={campoTexto} />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700">Identidad y domicilios</legend>
            <div>
              <label className={etiquetaCampo}>CURP</label>
              <input name="curp" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>RFC</label>
              <input name="rfc" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Domicilio particular</label>
              <input name="domicilio_particular" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Domicilio de notificaciones (si es distinto)</label>
              <input name="domicilio_notificaciones" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>INE — No. de identificación</label>
              <input name="ine_numero_identificacion" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>INE — Clave de elector</label>
              <input name="ine_clave_elector" className={campoTexto} />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700">INFONAVIT</legend>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" name="infonavit_tiene_credito" id="infonavit_tiene_credito" />
              <label htmlFor="infonavit_tiene_credito" className="text-sm text-slate-700">
                Tiene crédito INFONAVIT
              </label>
            </div>
            <div>
              <label className={etiquetaCampo}>No. de crédito</label>
              <input name="infonavit_numero_credito" className={campoTexto} />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-slate-700">Contacto de emergencia</legend>
            <div>
              <label className={etiquetaCampo}>Nombre</label>
              <input name="contacto_emergencia_nombre" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Teléfono</label>
              <input name="contacto_emergencia_telefono" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Parentesco</label>
              <input name="contacto_emergencia_parentesco" className={campoTexto} />
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700">Beneficiario (Art. 25/501 LFT)</legend>
            <div>
              <label className={etiquetaCampo}>Nombre</label>
              <input name="beneficiario_nombre" className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Parentesco</label>
              <input name="beneficiario_parentesco" className={campoTexto} />
            </div>
          </fieldset>

          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {crear.isPending ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {bajaDe && (
        <form onSubmit={onSubmitBaja} className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-slate-800">Dar de baja a {bajaDe.nombre}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={etiquetaCampo}>Fecha de baja</label>
              <input type="date" name="fecha_baja" required defaultValue={hoyIso()} className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Motivo</label>
              <select name="motivo" required className={campoTexto}>
                <option value="renuncia">Renuncia</option>
                <option value="termino_contrato">Término de contrato</option>
                <option value="despido">Despido</option>
                <option value="abandono">Abandono de trabajo</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className={etiquetaCampo}>Nota (opcional)</label>
              <input name="nota" className={campoTexto} placeholder="Ej. se va a otra empresa" />
            </div>
          </div>
          <p className="text-xs text-slate-600">
            El registro no se borra: expediente, asignaciones y contrataciones quedan como historial. Deja de aparecer en asignaciones
            diarias y en expedientes incompletos, y se puede reactivar si regresa. <b>Al confirmar, recuerda elaborar la carta finiquito</b>:
            queda como pendiente aquí mismo hasta que la marques entregada.
          </p>
          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button disabled={cambiarEstado.isPending} className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {cambiarEstado.isPending ? "Guardando…" : "Confirmar baja"}
            </button>
            <button type="button" onClick={() => setBajaDe(null)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!mostrarForm && !bajaDe && error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {finiquitosPendientes.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Carta finiquito pendiente ({finiquitosPendientes.length}): al dar de baja hay que elaborarla, firmarla y guardarla en el expediente.
          </p>
          {avisoVentana && <p className="mt-1 text-xs text-amber-800">{avisoVentana}</p>}
          <ul className="mt-2 space-y-1">
            {finiquitosPendientes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {p.nombre}
                  <span className="text-slate-500">
                    {" "}
                    · baja {p.fecha_baja ?? ""}
                    {p.motivo_baja ? ` · ${p.motivo_baja.replace(/_/g, " ")}` : ""}
                  </span>
                </span>
                <span className="flex gap-3">
                  <button type="button" onClick={() => generarFiniquito(p)} className="text-xs font-medium text-amber-800 hover:underline">
                    Generar carta finiquito
                  </button>
                  <button
                    type="button"
                    disabled={marcarFiniquito.isPending}
                    onClick={() => marcarFiniquito.mutate({ id: p.id, entregado: true })}
                    className="text-xs text-slate-700 hover:underline disabled:opacity-50"
                  >
                    Ya se entregó
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bajas > 0 && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={mostrarBajas} onChange={(e) => setMostrarBajas(e.target.checked)} />
          Mostrar bajas ({bajas})
        </label>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2">Fecha de ingreso</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Estatus</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {listado.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.activo ? "" : "text-slate-400"}`}>
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="px-3 py-2">{p.puesto ?? "—"}</td>
                <td className="px-3 py-2">{p.fecha_ingreso}</td>
                <td className="px-3 py-2">{p.telefono ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.activo
                    ? "Activo"
                    : `Baja ${p.fecha_baja ?? ""}${p.motivo_baja ? ` · ${p.motivo_baja.replace(/_/g, " ")}` : ""}${p.finiquito_entregado_en ? " · finiquito entregado" : " · finiquito pendiente"}`}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.activo ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setMostrarForm(false);
                        setBajaDe(p);
                      }}
                      className="text-xs text-amber-700 hover:underline"
                    >
                      Dar de baja
                    </button>
                  ) : (
                    <span className="flex justify-end gap-3">
                      <button type="button" onClick={() => generarFiniquito(p)} className="text-xs text-amber-800 hover:underline">
                        Carta finiquito
                      </button>
                      <button
                        type="button"
                        disabled={cambiarEstado.isPending}
                        onClick={() => {
                          setError(null);
                          cambiarEstado.mutate({ id: p.id, activo: true, fecha_baja: null, motivo_baja: null, finiquito_entregado_en: null });
                        }}
                        className="text-xs text-slate-700 hover:underline disabled:opacity-50"
                      >
                        Reactivar
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {listado.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  {personal?.length === 0 ? "Todavía no hay personal registrado." : "No hay personal activo."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Asignaciones diarias ("mover personal") ─────────────────────────────

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function useAsignacionesDelDia(fecha: string) {
  return useQuery({
    queryKey: ["rh-asignaciones", fecha],
    enabled: !!fecha,
    queryFn: async () => {
      const { data, error } = await supabase.from("asignaciones_diarias").select("*").eq("fecha", fecha);
      if (error) throw error;
      return data as AsignacionDiaria[];
    },
  });
}

function PestanaAsignaciones() {
  const [fecha, setFecha] = useState(hoyIso());
  const { data: personal } = usePersonal();
  const { data: empresas } = useEmpresas();
  const { data: asignaciones, isLoading } = useAsignacionesDelDia(fecha);
  const queryClient = useQueryClient();

  const guardar = useMutation({
    mutationFn: async (payload: { personal_id: string; fecha: string; empresa_id: string; proyecto: string | null }) => {
      const { error } = await supabase.from("asignaciones_diarias").upsert(payload, { onConflict: "personal_id,fecha" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rh-asignaciones", fecha] }),
  });

  const quitar = useMutation({
    mutationFn: async (personalId: string) => {
      const { error } = await supabase.from("asignaciones_diarias").delete().eq("personal_id", personalId).eq("fecha", fecha);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rh-asignaciones", fecha] }),
  });

  const personalActivo = personal?.filter((p) => p.activo) ?? [];
  const asignacionPorPersonal = new Map((asignaciones ?? []).map((a) => [a.personal_id, a]));

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Día:</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Asigna a qué empresa/obra trabajó cada persona ese día -- es la base del prorrateo inter-empresa. Cambiar la
        empresa y guardar reasigna el día completo (no crea un segundo renglón).
      </p>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Empresa / obra ese día</th>
              <th className="px-3 py-2">Proyecto (obra específica)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {personalActivo.map((p) => (
              <FilaAsignacion
                key={p.id}
                personal={p}
                fecha={fecha}
                asignacion={asignacionPorPersonal.get(p.id)}
                empresas={empresas ?? []}
                onGuardar={(empresaId, proyecto) => guardar.mutate({ personal_id: p.id, fecha, empresa_id: empresaId, proyecto })}
                onQuitar={() => quitar.mutate(p.id)}
              />
            ))}
            {personalActivo.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  No hay personal activo. Da de alta a alguien en la pestaña "Personal".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaAsignacion({
  personal,
  asignacion,
  empresas,
  onGuardar,
  onQuitar,
}: {
  personal: Personal;
  fecha: string;
  asignacion: AsignacionDiaria | undefined;
  empresas: { id: string; nombre: string }[];
  onGuardar: (empresaId: string, proyecto: string | null) => void;
  onQuitar: () => void;
}) {
  const [empresaId, setEmpresaId] = useState(asignacion?.empresa_id ?? "");
  const [proyecto, setProyecto] = useState(asignacion?.proyecto ?? "");

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-2">{personal.nombre}</td>
      <td className="px-3 py-2">
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
          <option value="">— sin asignar —</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} placeholder="opcional" className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-3 py-2">
        <button
          onClick={() => (empresaId ? onGuardar(empresaId, proyecto.trim() || null) : onQuitar())}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Guardar
        </button>
      </td>
    </tr>
  );
}

// ── Contrataciones ───────────────────────────────────────────────────────

const TIPOS_CONTRATO: { valor: TipoContrato; etiqueta: string }[] = [
  { valor: "laboral_determinado", etiqueta: "Contrato laboral (tiempo determinado)" },
  { valor: "laboral_indeterminado", etiqueta: "Contrato laboral (tiempo indeterminado)" },
  { valor: "prestacion_servicios", etiqueta: "Prestación de servicios" },
  { valor: "confidencialidad", etiqueta: "Confidencialidad" },
];

const ETIQUETA_TIPO_CONTRATO: Record<TipoContrato, string> = Object.fromEntries(
  TIPOS_CONTRATO.map((t) => [t.valor, t.etiqueta]),
) as Record<TipoContrato, string>;

function useContrataciones() {
  return useQuery({
    queryKey: ["rh-contrataciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contrataciones")
        .select("*, personal:personal_id(nombre), empresa:empresa_id(nombre)")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return data as (Contratacion & { personal: { nombre: string } | null; empresa: { nombre: string } | null })[];
    },
  });
}

function PestanaContrataciones() {
  const { data: personal } = usePersonal();
  const { data: empresas } = useEmpresas();
  const { data: contrataciones, isLoading } = useContrataciones();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("contrataciones").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rh-contrataciones"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      personal_id: fd.get("personal_id"),
      empresa_id: fd.get("empresa_id"),
      puesto: fd.get("puesto"),
      sueldo_semanal: Number(fd.get("sueldo_semanal")),
      fecha_inicio: fd.get("fecha_inicio"),
      duracion_dias: Number(fd.get("duracion_dias")),
      tipo_contrato: fd.get("tipo_contrato"),
    });
    (e.target as HTMLFormElement).reset();
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-6 grid max-w-3xl grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <label className={etiquetaCampo}>Persona *</label>
          <select name="personal_id" required className={campoTexto} defaultValue="">
            <option value="" disabled>
              Selecciona…
            </option>
            {personal?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiquetaCampo}>Empresa (patrón que firma) *</label>
          <select name="empresa_id" required className={campoTexto} defaultValue="">
            <option value="" disabled>
              Selecciona…
            </option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiquetaCampo}>Tipo de contrato *</label>
          <select name="tipo_contrato" required className={campoTexto} defaultValue="laboral_determinado">
            {TIPOS_CONTRATO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiquetaCampo}>Puesto *</label>
          <input name="puesto" required className={campoTexto} />
        </div>
        <div>
          <label className={etiquetaCampo}>Sueldo semanal *</label>
          <input type="number" step="0.01" min="0.01" name="sueldo_semanal" required className={campoTexto} />
        </div>
        <div>
          <label className={etiquetaCampo}>Fecha de inicio *</label>
          <input type="date" name="fecha_inicio" required className={campoTexto} />
        </div>
        <div>
          <label className={etiquetaCampo}>Duración (días) *</label>
          <input type="number" min="1" name="duracion_dias" required className={campoTexto} />
        </div>
        <div className="sm:col-span-3">
          {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {crear.isPending ? "Guardando…" : "Registrar contratación"}
          </button>
        </div>
      </form>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Empresa (patrón)</th>
              <th className="px-3 py-2">Tipo de contrato</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2 text-right">Sueldo semanal</th>
              <th className="px-3 py-2">Inicio</th>
              <th className="px-3 py-2">Fin</th>
              <th className="px-3 py-2">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {contrataciones?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{c.personal?.nombre ?? "—"}</td>
                <td className="px-3 py-2">{c.empresa?.nombre ?? "—"}</td>
                <td className="px-3 py-2">{ETIQUETA_TIPO_CONTRATO[c.tipo_contrato] ?? c.tipo_contrato}</td>
                <td className="px-3 py-2">{c.puesto}</td>
                <td className="px-3 py-2 text-right">${c.sueldo_semanal.toLocaleString("es-MX")}</td>
                <td className="px-3 py-2">{c.fecha_inicio}</td>
                <td className="px-3 py-2">{c.fecha_fin}</td>
                <td className="px-3 py-2">{c.estatus}</td>
              </tr>
            ))}
            {contrataciones?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay contrataciones registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
