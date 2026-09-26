import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { useAuth } from "../../lib/auth";
import { etiquetaSexo } from "../../lib/modulos";
import type { DocumentoFaltante, ExpedienteFila, ExtraccionDocumento, Personal } from "../../types/database";

// Expediente de personal: cada documento del checklist se sube como archivo
// (edge function rh-documentos -> bucket privado "cargas"), Claude le extrae
// los datos y RH decide qué aplicar a la ficha de la persona. Así el
// expediente deja de ser un "check de entregado" y se vuelve el almacén de
// datos del personal (CURP, RFC, NSS, INE, domicilio, licencia...).

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";

const fecha = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const hoyIso = () => new Date().toISOString().slice(0, 10);

/** Columna de `personal` <- campo extraído. Mismo mapeo que el edge function. */
const MAPEO_PERSONAL: { columna: keyof Personal; campo: string; etiqueta: string }[] = [
  { columna: "curp", campo: "curp", etiqueta: "CURP" },
  { columna: "rfc", campo: "rfc", etiqueta: "RFC" },
  { columna: "nss", campo: "nss", etiqueta: "NSS" },
  { columna: "fecha_nacimiento", campo: "fecha_nacimiento", etiqueta: "Fecha de nacimiento" },
  { columna: "sexo", campo: "sexo", etiqueta: "Sexo" },
  { columna: "ine_clave_elector", campo: "ine_clave_elector", etiqueta: "Clave de elector" },
  { columna: "ine_numero_identificacion", campo: "ine_numero_identificacion", etiqueta: "Núm. identificación INE" },
  { columna: "telefono", campo: "telefono", etiqueta: "Teléfono" },
  { columna: "correo", campo: "correo", etiqueta: "Correo" },
  { columna: "domicilio_particular", campo: "domicilio", etiqueta: "Domicilio particular" },
  { columna: "licencia_chofer_numero", campo: "licencia_numero", etiqueta: "Licencia (número)" },
  { columna: "licencia_chofer_vigencia", campo: "licencia_vigencia", etiqueta: "Licencia (vigencia)" },
];

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre_completo: "Nombre en el documento",
  curp: "CURP",
  rfc: "RFC",
  nss: "NSS",
  fecha_nacimiento: "Fecha de nacimiento",
  sexo: "Sexo",
  domicilio: "Domicilio",
  codigo_postal: "Código postal",
  ine_clave_elector: "Clave de elector",
  ine_numero_identificacion: "Núm. identificación INE",
  ine_vigencia: "Vigencia INE",
  telefono: "Teléfono",
  correo: "Correo",
  regimen_fiscal: "Régimen fiscal",
  licencia_numero: "Licencia (número)",
  licencia_tipo: "Licencia (tipo)",
  licencia_vigencia: "Licencia (vigencia)",
  fecha_emision: "Fecha de emisión",
  fecha_vencimiento: "Fecha de vencimiento",
  emisor: "Emisor",
};

const FICHA: { columna: keyof Personal; etiqueta: string }[] = [
  { columna: "curp", etiqueta: "CURP" },
  { columna: "rfc", etiqueta: "RFC" },
  { columna: "nss", etiqueta: "NSS" },
  { columna: "ine_clave_elector", etiqueta: "Clave de elector" },
  { columna: "ine_numero_identificacion", etiqueta: "Núm. identificación INE" },
  { columna: "fecha_nacimiento", etiqueta: "Fecha de nacimiento" },
  { columna: "sexo", etiqueta: "Sexo" },
  { columna: "telefono", etiqueta: "Teléfono" },
  { columna: "correo", etiqueta: "Correo" },
  { columna: "domicilio_particular", etiqueta: "Domicilio particular" },
  { columna: "licencia_chofer_numero", etiqueta: "Licencia" },
];

function usePersonalLista() {
  return useQuery({
    queryKey: ["rh-personal"],
    queryFn: async () => {
      const { data, error } = await supabase.from("personal").select("*").order("nombre");
      if (error) throw error;
      return data as Personal[];
    },
  });
}

function useExpediente(personalId: string | null) {
  return useQuery({
    queryKey: ["rh-expediente", personalId],
    enabled: !!personalId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_expediente_personal").select("*").eq("personal_id", personalId!).order("orden");
      if (error) throw error;
      return data as ExpedienteFila[];
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

function sumarMeses(fechaIso: string, meses: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

/** Un solo PDF con todo el expediente: se sube una vez y se registra como
 * entregado cada documento marcado (todos apuntan al mismo archivo). */
function SubirExpedienteCompleto({ persona, filas, onSubido }: { persona: Personal; filas: ExpedienteFila[]; onSubido: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(filas.filter((f) => f.estado !== "vigente").map((f) => f.tipo_documento_id)));

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const archivo = fd.get("file") as File | null;
    if (!archivo || archivo.size === 0) return setError("Elige el PDF con el expediente.");
    if (marcados.size === 0) return setError("Marca al menos un documento que venga en el PDF.");
    setSubiendo(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append("file", archivo);
      cuerpo.append("personalId", persona.id);
      cuerpo.append("tipoDocumentoIds", [...marcados].join(","));
      cuerpo.append("fechaEntrega", String(fd.get("fechaEntrega") ?? hoyIso()));
      const respuesta = await fetch(urlFuncion("rh-documentos"), {
        method: "POST",
        headers: { Authorization: `Bearer ${await tokenSesion()}` },
        body: cuerpo,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      form.reset();
      setAbierto(false);
      onSubido();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">Expediente completo en un solo PDF</p>
          <p className="text-xs text-slate-500">Sube un archivo con toda la documentación y marca qué documentos vienen; cada uno queda como entregado.</p>
        </div>
        <button onClick={() => setAbierto((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {abierto ? "Cancelar" : "Subir un solo PDF"}
        </button>
      </div>
      {abierto && (
        <form onSubmit={onSubmit} className="mt-3 space-y-3 rounded bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={etiquetaCampo}>Archivo PDF</label>
              <input name="file" type="file" accept="application/pdf" required className="w-full text-sm" />
            </div>
            <div>
              <label className={etiquetaCampo}>Fecha de entrega</label>
              <input name="fechaEntrega" type="date" defaultValue={hoyIso()} className={campoTexto} />
            </div>
          </div>
          <div>
            <p className={etiquetaCampo}>Documentos que vienen en el PDF</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {filas.map((f) => (
                <label key={f.tipo_documento_id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={marcados.has(f.tipo_documento_id)} onChange={() => alternar(f.tipo_documento_id)} />
                  {f.tipo_documento_nombre}
                  {f.estado === "vigente" && <span className="text-xs text-emerald-600">(ya vigente)</span>}
                </label>
              ))}
            </div>
          </div>
          <button disabled={subiendo} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {subiendo ? "Subiendo y leyendo…" : `Subir y marcar ${marcados.size} documento(s)`}
          </button>
          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </form>
      )}
    </section>
  );
}

async function tokenSesion() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export function PestanaDocumentos({ personalInicial }: { personalInicial?: string | null } = {}) {
  const { perfil } = useAuth();
  const { data: personal } = usePersonalLista();
  const { data: faltantes, isLoading: cargandoFaltantes } = useDocumentosFaltantes();
  const [personaId, setPersonaId] = useState<string | null>(personalInicial ?? null);
  // Llegada desde Personal con ?personal=<id>: se abre ese expediente.
  useEffect(() => {
    if (personalInicial) setPersonaId(personalInicial);
  }, [personalInicial]);

  const persona = personal?.find((p) => p.id === personaId) ?? null;
  // rh_documentos sube archivos; aplicar datos a la ficha y verificar es de RH/admin.
  const puedeAplicar = perfil?.rol === "rh" || perfil?.rol === "admin";

  const faltantesPorPersona = new Map<string, { id: string; docs: DocumentoFaltante[] }>();
  for (const f of faltantes ?? []) {
    const e = faltantesPorPersona.get(f.personal_nombre) ?? { id: f.personal_id, docs: [] };
    e.docs.push(f);
    faltantesPorPersona.set(f.personal_nombre, e);
  }

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <label className={etiquetaCampo}>Persona</label>
        <select value={personaId ?? ""} onChange={(e) => setPersonaId(e.target.value || null)} className={campoTexto}>
          <option value="">Selecciona a quién le vas a armar el expediente…</option>
          {personal?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
              {!p.activo ? " (baja)" : ""}
            </option>
          ))}
        </select>
      </div>

      {persona && <ExpedientePersona persona={persona} puedeAplicar={puedeAplicar} />}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Expediente incompleto (todo el personal activo)</h2>
        {cargandoFaltantes && <p className="text-sm text-slate-400">Cargando…</p>}
        {faltantesPorPersona.size === 0 && !cargandoFaltantes && (
          <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">Todo el personal activo tiene su expediente completo.</p>
        )}
        <div className="space-y-2">
          {[...faltantesPorPersona.entries()].map(([nombre, e]) => (
            <button
              key={nombre}
              onClick={() => setPersonaId(e.id)}
              className="block w-full rounded border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-100"
            >
              <p className="text-sm font-medium text-amber-900">{nombre}</p>
              <p className="text-xs text-amber-800">Falta: {e.docs.map((d) => d.tipo_documento_nombre).join(", ")}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ExpedientePersona({ persona, puedeAplicar }: { persona: Personal; puedeAplicar: boolean }) {
  const queryClient = useQueryClient();
  const { data: filas, isLoading } = useExpediente(persona.id);
  const completos = (filas ?? []).filter((f) => f.estado === "vigente").length;

  return (
    <div className="space-y-4">
      {/* La ficha: el "almacén" de datos de la persona, alimentado desde los documentos. */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{persona.nombre}</h2>
          <p className="text-xs text-slate-500">
            {persona.puesto ?? "Sin puesto"} · ingreso {fecha(persona.fecha_ingreso)} · {completos}/{filas?.length ?? 0} documentos vigentes
          </p>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {FICHA.map((c) => {
            const v = persona[c.columna];
            return (
              <div key={c.columna} className="flex gap-2">
                <dt className="w-40 shrink-0 text-xs uppercase tracking-wide text-slate-500">{c.etiqueta}</dt>
                <dd className={v ? "text-slate-900" : "text-slate-300"}>{v ? (c.columna === "sexo" ? etiquetaSexo(String(v)) : String(v)) : "—"}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      {isLoading && <p className="text-sm text-slate-400">Cargando expediente…</p>}
      {filas && filas.length > 0 && (
        <SubirExpedienteCompleto
          key={filas.map((f) => f.documento_id ?? "-").join("|")}
          persona={persona}
          filas={filas}
          onSubido={() => {
            queryClient.invalidateQueries({ queryKey: ["rh-expediente", persona.id] });
            queryClient.invalidateQueries({ queryKey: ["rh-documentos-faltantes"] });
          }}
        />
      )}
      {filas?.map((f) => <FilaDocumento key={f.tipo_documento_id} fila={f} persona={persona} puedeAplicar={puedeAplicar} />)}
    </div>
  );
}

const ESTADO: Record<ExpedienteFila["estado"], { etiqueta: string; clase: string }> = {
  vigente: { etiqueta: "Vigente", clase: "bg-emerald-50 text-emerald-700" },
  vencido: { etiqueta: "Vencido", clase: "bg-red-50 text-red-700" },
  falta: { etiqueta: "Falta", clase: "bg-slate-100 text-slate-600" },
};

function FilaDocumento({ fila, persona, puedeAplicar }: { fila: ExpedienteFila; persona: Personal; puedeAplicar: boolean }) {
  const queryClient = useQueryClient();
  const [subiendo, setSubiendo] = useState(false);
  const [mostrarSubir, setMostrarSubir] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["rh-expediente", persona.id] });
    queryClient.invalidateQueries({ queryKey: ["rh-documentos-faltantes"] });
    queryClient.invalidateQueries({ queryKey: ["rh-personal"] });
  };

  async function onSubir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const archivo = fd.get("file") as File | null;
    if (!archivo || archivo.size === 0) return setError("Elige el archivo del documento.");
    setSubiendo(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append("file", archivo);
      cuerpo.append("personalId", persona.id);
      cuerpo.append("tipoDocumentoId", fila.tipo_documento_id);
      cuerpo.append("fechaEntrega", String(fd.get("fechaEntrega") ?? hoyIso()));
      const respuesta = await fetch(urlFuncion("rh-documentos"), {
        method: "POST",
        headers: { Authorization: `Bearer ${await tokenSesion()}` },
        body: cuerpo,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      form.reset();
      setMostrarSubir(false);
      invalidar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function verArchivo() {
    if (!fila.documento_id) return;
    setAbriendo(true);
    setError(null);
    try {
      const respuesta = await fetch(`${urlFuncion("rh-documentos")}?documentoId=${fila.documento_id}`, {
        headers: { Authorization: `Bearer ${await tokenSesion()}` },
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      window.open(json.url, "_blank", "noopener");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAbriendo(false);
    }
  }

  const verificar = useMutation({
    mutationFn: async (verificado: boolean) => {
      const { data: sesion } = await supabase.auth.getSession();
      const { error } = await supabase
        .from("documentos_personal")
        .update({ verificado, verificado_por: verificado ? sesion.session?.user.id : null, verificado_at: verificado ? new Date().toISOString() : null })
        .eq("id", fila.documento_id!);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  // Checklist sin archivo: marcar "entregado" registra el documento con la
  // fecha de hoy (y su vigencia); desmarcarlo quita ese registro. Solo
  // aplica cuando el registro no trae archivo -- un archivo subido no se
  // borra desde aquí.
  const entregado = useMutation({
    mutationFn: async (marcar: boolean) => {
      const { data: sesion } = await supabase.auth.getSession();
      if (marcar) {
        const hoy = hoyIso();
        const { error } = await supabase.from("documentos_personal").insert({
          personal_id: persona.id,
          tipo_documento_id: fila.tipo_documento_id,
          fecha_entrega: hoy,
          fecha_vigencia: fila.vigencia_meses ? sumarMeses(hoy, fila.vigencia_meses) : null,
          created_by: sesion.session?.user.id,
        });
        if (error) throw error;
      } else if (fila.documento_id) {
        const { error } = await supabase.from("documentos_personal").delete().eq("id", fila.documento_id).is("storage_path", null);
        if (error) throw error;
      }
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  const estado = ESTADO[fila.estado];
  const tieneArchivo = !!fila.storage_path;
  const puedeMarcar = puedeAplicar && (!fila.documento_id || !tieneArchivo);

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {puedeMarcar ? (
          <input
            type="checkbox"
            title={fila.documento_id ? "Desmarcar entregado" : "Marcar como entregado (sin archivo)"}
            checked={fila.estado === "vigente"}
            disabled={entregado.isPending}
            onChange={(e) => entregado.mutate(e.target.checked)}
          />
        ) : (
          <input type="checkbox" checked={fila.estado === "vigente"} disabled title="Tiene archivo; sube una versión nueva para renovarlo" />
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estado.clase}`}>{estado.etiqueta}</span>
        <p className="grow text-sm font-medium text-slate-900">{fila.tipo_documento_nombre}</p>
        {fila.documento_id && (
          <p className="text-xs text-slate-500">
            entregado {fecha(fila.fecha_entrega)}
            {fila.fecha_vigencia && ` · vence ${fecha(fila.fecha_vigencia)}`}
            {!tieneArchivo && " · sin archivo"}
          </p>
        )}
        {tieneArchivo && (
          <button onClick={verArchivo} disabled={abriendo} className="text-xs text-slate-600 underline disabled:opacity-50">
            {abriendo ? "abriendo…" : "ver archivo"}
          </button>
        )}
        {fila.documento_id && puedeAplicar && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={!!fila.verificado} onChange={(e) => verificar.mutate(e.target.checked)} />
            verificado
          </label>
        )}
        <button onClick={() => setMostrarSubir((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {mostrarSubir ? "Cancelar" : fila.documento_id ? "Subir versión nueva" : "Subir archivo"}
        </button>
      </div>

      {mostrarSubir && (
        <form onSubmit={onSubir} className="mt-3 grid gap-2 rounded bg-slate-50 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label className={etiquetaCampo}>Archivo (PDF o foto JPG/PNG)</label>
            <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="w-full text-sm" />
          </div>
          <div>
            <label className={etiquetaCampo}>Fecha de entrega</label>
            <input name="fechaEntrega" type="date" defaultValue={hoyIso()} className={campoTexto} />
          </div>
          <button disabled={subiendo} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {subiendo ? "Subiendo y leyendo…" : "Subir y extraer datos"}
          </button>
          <p className="text-xs text-slate-500 sm:col-span-3">
            Al subirlo, la IA lee el documento y propone los datos; nada se guarda en la ficha hasta que RH lo aplique.
          </p>
        </form>
      )}

      {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {fila.documento_id && fila.error_extraccion && !fila.datos_extraidos && (
        <p className="mt-2 text-xs text-amber-700">No se pudo leer con IA: {fila.error_extraccion}. El archivo sí quedó guardado.</p>
      )}
      {fila.documento_id && fila.datos_extraidos && (
        <DatosExtraidos documentoId={fila.documento_id} extraccion={fila.datos_extraidos} aplicadoEn={fila.aplicado_en} persona={persona} puedeAplicar={puedeAplicar} onAplicado={invalidar} />
      )}
    </section>
  );
}

function DatosExtraidos({
  documentoId,
  extraccion,
  aplicadoEn,
  persona,
  puedeAplicar,
  onAplicado,
}: {
  documentoId: string;
  extraccion: ExtraccionDocumento;
  aplicadoEn: string | null;
  persona: Personal;
  puedeAplicar: boolean;
  onAplicado: () => void;
}) {
  const [abierto, setAbierto] = useState(!aplicadoEn);
  const [error, setError] = useState<string | null>(null);

  // Sugerencias: lo extraído que trae valor y difiere de la ficha.
  const sugerencias = MAPEO_PERSONAL.map((m) => {
    const nuevo = extraccion.campos[m.campo];
    const actual = persona[m.columna];
    if (!nuevo) return null;
    if (actual && String(actual).trim().toUpperCase() === nuevo.trim().toUpperCase()) return null;
    return { ...m, nuevo, actual: actual ? String(actual) : null };
  }).filter((s): s is NonNullable<typeof s> => s !== null);
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(sugerencias.filter((s) => !s.actual).map((s) => s.columna)));

  const aplicar = useMutation({
    mutationFn: async () => {
      const cambios: Record<string, string> = {};
      for (const s of sugerencias) if (elegidas.has(s.columna)) cambios[s.columna] = s.nuevo;
      if (Object.keys(cambios).length === 0) throw new Error("Marca al menos un dato para aplicar.");
      const { error: e1 } = await supabase.from("personal").update(cambios).eq("id", persona.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("documentos_personal").update({ aplicado_en: new Date().toISOString() }).eq("id", documentoId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      setAbierto(false);
      onAplicado();
    },
    onError: (err) => setError((err as Error).message),
  });

  const camposLeidos = Object.entries(extraccion.campos).filter(([, v]) => !!v);
  const tonoConfianza = extraccion.confianza === "alta" ? "text-emerald-700" : extraccion.confianza === "baja" ? "text-red-700" : "text-amber-700";

  return (
    <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full flex-wrap items-center gap-2 text-left">
        <span className="font-medium text-slate-700">Datos leídos por IA</span>
        <span className={`text-xs ${tonoConfianza}`}>confianza {extraccion.confianza}</span>
        {extraccion.coincide_con_persona === false && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">el nombre del documento no coincide</span>}
        {aplicadoEn && <span className="text-xs text-slate-500">· aplicado a la ficha</span>}
        <span className="ml-auto text-xs text-slate-400">{abierto ? "ocultar" : "ver"}</span>
      </button>

      {abierto && (
        <div className="mt-2 space-y-3">
          {extraccion.observaciones && <p className="text-xs text-slate-600">{extraccion.observaciones}</p>}
          {camposLeidos.length === 0 ? (
            <p className="text-xs text-slate-500">No se pudo leer ningún dato de este archivo.</p>
          ) : (
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {camposLeidos.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-44 shrink-0 text-xs uppercase tracking-wide text-slate-500">{ETIQUETA_CAMPO[k] ?? k}</dt>
                  <dd className="text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {sugerencias.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Para la ficha de {persona.nombre}</p>
              <div className="space-y-1">
                {sugerencias.map((s) => (
                  <label key={s.columna} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!puedeAplicar}
                      checked={elegidas.has(s.columna)}
                      onChange={(e) => {
                        const n = new Set(elegidas);
                        if (e.target.checked) n.add(s.columna);
                        else n.delete(s.columna);
                        setElegidas(n);
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-slate-700">{s.etiqueta}:</span> <span className="font-medium text-slate-900">{s.columna === "sexo" ? etiquetaSexo(s.nuevo) : s.nuevo}</span>
                      {s.actual && <span className="ml-1 text-xs text-amber-700">(hoy: {s.columna === "sexo" ? etiquetaSexo(s.actual) : s.actual})</span>}
                    </span>
                  </label>
                ))}
              </div>
              {puedeAplicar ? (
                <button onClick={() => aplicar.mutate()} disabled={aplicar.isPending} className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  {aplicar.isPending ? "Aplicando…" : "Aplicar a la ficha"}
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500">RH revisa y aplica estos datos a la ficha.</p>
              )}
            </div>
          )}
          {sugerencias.length === 0 && camposLeidos.length > 0 && <p className="text-xs text-slate-500">La ficha ya tiene estos datos.</p>}
          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
