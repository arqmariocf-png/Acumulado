import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { AsignacionDiaria, Contratacion, DocumentoFaltante, Personal, TipoDocumentoPersonal } from "../types/database";

type Pestana = "personal" | "asignaciones" | "contrataciones" | "documentos";

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "personal", etiqueta: "Personal" },
  { valor: "asignaciones", etiqueta: "Asignaciones diarias" },
  { valor: "contrataciones", etiqueta: "Contrataciones" },
  { valor: "documentos", etiqueta: "Documentos / Expediente" },
];

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
  const [pestana, setPestana] = useState<Pestana>("personal");

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Recursos Humanos</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {PESTANAS.map((p) => (
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

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2">Fecha de ingreso</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {personal?.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="px-3 py-2">{p.puesto ?? "—"}</td>
                <td className="px-3 py-2">{p.fecha_ingreso}</td>
                <td className="px-3 py-2">{p.telefono ?? "—"}</td>
                <td className="px-3 py-2">{p.activo ? "Sí" : "No"}</td>
              </tr>
            ))}
            {personal?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay personal registrado.
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
                <td className="px-3 py-2">{c.puesto}</td>
                <td className="px-3 py-2 text-right">${c.sueldo_semanal.toLocaleString("es-MX")}</td>
                <td className="px-3 py-2">{c.fecha_inicio}</td>
                <td className="px-3 py-2">{c.fecha_fin}</td>
                <td className="px-3 py-2">{c.estatus}</td>
              </tr>
            ))}
            {contrataciones?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
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

// ── Documentos / Expediente ──────────────────────────────────────────────

function useTiposDocumento() {
  return useQuery({
    queryKey: ["rh-tipos-documento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tipos_documento_personal").select("*").eq("activo", true).order("orden");
      if (error) throw error;
      return data as TipoDocumentoPersonal[];
    },
  });
}

function useDocumentosFaltantes() {
  return useQuery({
    queryKey: ["rh-documentos-faltantes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_documentos_faltantes_personal").select("*");
      if (error) throw error;
      return data as DocumentoFaltante[];
    },
  });
}

/** fecha_entrega + N meses, en ISO -- el cálculo real vive aquí porque
 * fecha_vigencia depende de tipos_documento_personal.vigencia_meses, y eso
 * no se puede resolver en una columna generada de SQL (ver comentario de la
 * migración). */
function sumarMeses(fechaIso: string, meses: number): string {
  const d = new Date(fechaIso + "T00:00:00");
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function PestanaDocumentos() {
  const { data: personal } = usePersonal();
  const { data: tipos } = useTiposDocumento();
  const { data: faltantes, isLoading: cargandoFaltantes } = useDocumentosFaltantes();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const registrar = useMutation({
    mutationFn: async (payload: { personal_id: string; tipo_documento_id: string; fecha_entrega: string; fecha_vigencia: string | null }) => {
      const { error } = await supabase.from("documentos_personal").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rh-documentos-faltantes"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const tipoId = fd.get("tipo_documento_id") as string;
    const fechaEntrega = fd.get("fecha_entrega") as string;
    const tipo = tipos?.find((t) => t.id === tipoId);
    registrar.mutate({
      personal_id: fd.get("personal_id") as string,
      tipo_documento_id: tipoId,
      fecha_entrega: fechaEntrega,
      fecha_vigencia: tipo?.vigencia_meses ? sumarMeses(fechaEntrega, tipo.vigencia_meses) : null,
    });
    (e.target as HTMLFormElement).reset();
  }

  const faltantesPorPersona = new Map<string, DocumentoFaltante[]>();
  for (const f of faltantes ?? []) {
    const lista = faltantesPorPersona.get(f.personal_nombre) ?? [];
    lista.push(f);
    faltantesPorPersona.set(f.personal_nombre, lista);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-6 grid max-w-2xl grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3">
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
          <label className={etiquetaCampo}>Documento *</label>
          <select name="tipo_documento_id" required className={campoTexto} defaultValue="">
            <option value="" disabled>
              Selecciona…
            </option>
            {tipos?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiquetaCampo}>Fecha de entrega *</label>
          <input type="date" name="fecha_entrega" required defaultValue={hoyIso()} className={campoTexto} />
        </div>
        <div className="sm:col-span-3">
          <p className="mb-2 text-xs text-slate-500">
            La subida del archivo físico (PDF/foto) todavía no está conectada a Storage -- por ahora esto solo registra que
            el documento se entregó y calcula su vigencia.
          </p>
          {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={registrar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {registrar.isPending ? "Guardando…" : "Registrar documento entregado"}
          </button>
        </div>
      </form>

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Expediente incompleto</h2>
      {cargandoFaltantes && <p className="text-sm text-slate-400">Cargando…</p>}

      {faltantesPorPersona.size === 0 && !cargandoFaltantes && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Todo el personal activo tiene su expediente completo.
        </p>
      )}

      <div className="space-y-3">
        {[...faltantesPorPersona.entries()].map(([nombre, docs]) => (
          <div key={nombre} className="rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">{nombre}</p>
            <p className="text-xs text-amber-800">Falta: {docs.map((d) => d.tipo_documento_nombre).join(", ")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
