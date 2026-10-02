import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import {
  CIUDAD_FIRMA_DEFAULT,
  docContratoCredito,
  faltantesContrato,
  htmlContratoCredito,
  nombreArchivoContrato,
  proveedorDesdePerfil,
  type CompradorContrato,
  type DatosContrato,
  type FilaPerfilLegal,
  type LegalesCliente,
} from "../../lib/contratoCredito";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { DocumentosLegal } from "./DocumentosLegal";
import { autorizaCredito, fechaCorta } from "./comun";

interface Cliente {
  id: string;
  empresa_id: string;
  razon_social: string;
  rfc: string | null;
  domicilio: string | null;
  email: string | null;
  telefono: string | null;
}

interface Credito {
  cliente_id: string;
  empresa_id: string;
  autorizado: boolean;
  autorizado_en: string | null;
  autorizado_por_nombre: string | null;
  linea_credito: number | null;
  dias_credito: number | null;
  interes_moratorio_pct: number;
  tipo_persona: "moral" | "fisica";
  representante_nombre: string | null;
  representante_cargo: string | null;
  representante_tratamiento: string | null;
  domicilio_legal: string | null;
  correos: string | null;
  telefonos: string | null;
  obligado_solidario_nombre: string | null;
  legales: LegalesCliente;
  notas: string | null;
  clientes: Cliente | null;
}

interface Contrato {
  id: string;
  empresa_id: string;
  cliente_id: string;
  folio: string | null;
  monto: number;
  fecha_firma: string;
  ciudad_firma: string | null;
  datos: DatosContrato;
  estatus: "borrador" | "firmado" | "cancelado";
  firmado_en: string | null;
  created_at: string;
}

const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const hoy = () => new Date().toISOString().slice(0, 10);

function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob(["﻿", contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function compradorDesde(c: Credito): CompradorContrato {
  return {
    razon_social: c.clientes?.razon_social ?? "",
    tipo_persona: c.tipo_persona,
    representante_nombre: c.representante_nombre,
    representante_cargo: c.representante_cargo,
    representante_tratamiento: c.representante_tratamiento,
    rfc: c.clientes?.rfc ?? null,
    domicilio_legal: c.domicilio_legal || c.clientes?.domicilio || null,
    correos: c.correos || c.clientes?.email || null,
    telefonos: c.telefonos || c.clientes?.telefono || null,
    obligado_solidario_nombre: c.obligado_solidario_nombre,
    legales: c.legales ?? {},
  };
}

/** Crédito a clientes y su contrato (1-oct-2026): legal captura los datos
 * del cliente, dirección autoriza la línea y, autorizado, el contrato de los
 * abogados se llena solo (imprimir/PDF o Word). */
export function CreditoContratos() {
  const { perfil, suscripcionPermiteEscribir } = useAuth();
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [editando, setEditando] = useState<string | "nuevo" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const autoriza = autorizaCredito(perfil);

  const { data: creditos, isLoading, error } = useQuery({
    queryKey: ["clientes-credito", empresa],
    queryFn: async () => {
      let q = supabase.from("clientes_credito").select("*, clientes(id, empresa_id, razon_social, rfc, domicilio, email, telefono)").order("updated_at", { ascending: false });
      if (empresa) q = q.eq("empresa_id", empresa);
      const { data, error: err } = await q;
      if (err) throw err;
      return (data ?? []) as Credito[];
    },
  });

  const { data: contratos } = useQuery({
    queryKey: ["legal-contratos", empresa],
    queryFn: async () => {
      let q = supabase.from("legal_contratos").select("*").order("created_at", { ascending: false });
      if (empresa) q = q.eq("empresa_id", empresa);
      const { data, error: err } = await q;
      if (err) throw err;
      return (data ?? []) as Contrato[];
    },
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["clientes-credito"] });
    queryClient.invalidateQueries({ queryKey: ["legal-contratos"] });
  };

  const autorizar = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: boolean }) => {
      const { error: err } = await supabase.from("clientes_credito").update({ autorizado: valor }).eq("cliente_id", id);
      if (err) throw err;
    },
    onSuccess: refrescar,
    onError: (e) => setMsg((e as Error).message),
  });

  const enEdicion = editando && editando !== "nuevo" ? (creditos ?? []).find((c) => c.cliente_id === editando) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorEmpresa value={empresa} onChange={setEmpresa} />
        <span className="text-xs text-slate-500">La empresa es la que vende y da el crédito (“EL PROVEEDOR”).</span>
        {suscripcionPermiteEscribir && (
          <button type="button" onClick={() => setEditando(editando === "nuevo" ? null : "nuevo")} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            {editando === "nuevo" ? "Cerrar" : "Crédito a un cliente"}
          </button>
        )}
      </div>
      <p className="rounded bg-sky-50 px-3 py-2 text-xs text-sky-900">
        Pasos: 1) legal captura los datos del cliente y la línea propuesta · 2) {autoriza ? "tú autorizas" : "dirección autoriza"} el crédito · 3) “Generar contrato” llena el machote de los abogados; se imprime o se baja en Word · 4) firmado, se marca y se sube escaneado.
      </p>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {editando && (
        <FormCredito
          key={editando}
          credito={enEdicion}
          empresaInicial={empresa || perfil?.empresa_id || ""}
          onListo={() => {
            setEditando(null);
            refrescar();
          }}
        />
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {!isLoading && (creditos ?? []).length === 0 && <p className="text-sm text-slate-400">Ningún cliente con crédito en esta empresa.</p>}

      <div className="space-y-3">
        {(creditos ?? []).map((c) => (
          <div key={c.cliente_id} className="rounded border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1">
                <div className="font-medium text-slate-900">{c.clientes?.razon_social}</div>
                <div className="text-xs text-slate-500">
                  {c.clientes?.rfc ?? "sin RFC"} · {c.tipo_persona === "moral" ? `${c.representante_cargo ?? "representante"}: ${c.representante_nombre ?? "—"}` : "persona física"}
                  {c.obligado_solidario_nombre ? ` · obligado solidario: ${c.obligado_solidario_nombre}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{c.linea_credito != null ? moneda(Number(c.linea_credito)) : "sin línea"}</div>
                <div className="text-xs text-slate-500">{c.dias_credito != null ? `${c.dias_credito} días · ` : ""}moratorio {Number(c.interes_moratorio_pct)}% mensual</div>
              </div>
              <div className="w-full sm:w-auto">
                {c.autorizado ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Autorizado{c.autorizado_por_nombre ? ` por ${c.autorizado_por_nombre}` : ""}{c.autorizado_en ? ` · ${fechaCorta(c.autorizado_en)}` : ""}</span>
                ) : (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Por autorizar</span>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {suscripcionPermiteEscribir && (
                <button type="button" onClick={() => setEditando(c.cliente_id)} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100">Editar datos</button>
              )}
              {suscripcionPermiteEscribir && autoriza && !c.autorizado && (
                <button type="button" onClick={() => autorizar.mutate({ id: c.cliente_id, valor: true })} className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white">Autorizar crédito</button>
              )}
              {suscripcionPermiteEscribir && autoriza && c.autorizado && (
                <button type="button" onClick={() => confirm("¿Quitar la autorización del crédito?") && autorizar.mutate({ id: c.cliente_id, valor: false })} className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50">Quitar autorización</button>
              )}
              {c.autorizado && suscripcionPermiteEscribir && <GenerarContrato credito={c} onListo={refrescar} />}
            </div>
            <ListaContratos contratos={(contratos ?? []).filter((k) => k.cliente_id === c.cliente_id)} onCambio={refrescar} />
          </div>
        ))}
      </div>
    </div>
  );
}

function abrirContrato(datos: DatosContrato, formato: "imprimir" | "word") {
  if (formato === "word") {
    descargar(nombreArchivoContrato(datos, "doc"), docContratoCredito(datos), "application/msword");
    return;
  }
  const ventana = abrirVentanaImpresion();
  abrirParaImprimir(htmlContratoCredito(datos), ventana);
}

function GenerarContrato({ credito, onListo }: { credito: Credito; onListo: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(hoy());
  const [monto, setMonto] = useState(String(credito.linea_credito ?? ""));
  const [msg, setMsg] = useState<string | null>(null);

  const { data: base } = useQuery({
    enabled: abierto,
    queryKey: ["perfil-legal-contrato", credito.empresa_id],
    queryFn: async () => {
      const [{ data: perfil, error: e1 }, { data: emp, error: e2 }] = await Promise.all([
        supabase.from("empresas_perfil_legal").select("*").eq("empresa_id", credito.empresa_id).maybeSingle(),
        supabase.from("empresas").select("nombre").eq("id", credito.empresa_id).single(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { perfil: perfil as FilaPerfilLegal | null, nombre: emp.nombre as string };
    },
  });

  const datos: DatosContrato | null = base
    ? {
        proveedor: proveedorDesdePerfil(base.perfil ?? ({} as FilaPerfilLegal), base.nombre),
        comprador: compradorDesde(credito),
        monto: Number(monto) || 0,
        interes_moratorio_pct: Number(credito.interes_moratorio_pct),
        fecha_firma: fecha,
        ciudad_firma: base.perfil?.ciudad_firma || CIUDAD_FIRMA_DEFAULT,
      }
    : null;
  const faltan = datos ? faltantesContrato(datos) : [];

  const generar = useMutation({
    mutationFn: async ({ formato, ventana }: { formato: "imprimir" | "word"; ventana: Window | null }) => {
      if (!datos) throw new Error("Cargando datos…");
      const { data, error } = await supabase
        .from("legal_contratos")
        .insert({ empresa_id: credito.empresa_id, cliente_id: credito.cliente_id, monto: datos.monto, fecha_firma: fecha, ciudad_firma: datos.ciudad_firma, datos })
        .select("id, folio")
        .single();
      if (error) {
        ventana?.close();
        throw error;
      }
      const final = { ...datos, folio: data.folio as string };
      await supabase.from("legal_contratos").update({ datos: final }).eq("id", data.id);
      if (formato === "imprimir") abrirParaImprimir(htmlContratoCredito(final), ventana);
      else abrirContrato(final, "word");
    },
    onSuccess: () => {
      setAbierto(false);
      onListo();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  if (!abierto)
    return (
      <button type="button" onClick={() => setAbierto(true)} className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white">
        Generar contrato
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded bg-slate-50 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">Fecha de firma<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Línea de crédito<input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} className={inp} /></label>
        <button type="button" disabled={!datos || generar.isPending} onClick={() => datos && abrirContrato(datos, "imprimir")} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white disabled:opacity-50">Vista previa</button>
        <button type="button" disabled={!datos || generar.isPending} onClick={() => generar.mutate({ formato: "imprimir", ventana: abrirVentanaImpresion() })} className="rounded bg-slate-900 px-2.5 py-1.5 text-xs text-white disabled:opacity-50">Generar e imprimir</button>
        <button type="button" disabled={!datos || generar.isPending} onClick={() => generar.mutate({ formato: "word", ventana: null })} className="rounded bg-slate-700 px-2.5 py-1.5 text-xs text-white disabled:opacity-50">Generar en Word</button>
        <button type="button" onClick={() => setAbierto(false)} className="text-xs text-slate-500">cancelar</button>
      </div>
      {Number(monto) !== Number(credito.linea_credito) && <p className="text-xs text-amber-700">Ojo: el monto es distinto a la línea autorizada ({moneda(Number(credito.linea_credito ?? 0))}).</p>}
      {faltan.length > 0 && (
        <p className="text-xs text-amber-800">
          Falta capturar (saldrá en blanco “____”): {faltan.join(" · ")}. Los datos de la empresa están en la pestaña “Datos legales de la empresa”.
        </p>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}

function ListaContratos({ contratos, onCambio }: { contratos: Contrato[]; onCambio: () => void }) {
  const { suscripcionPermiteEscribir } = useAuth();
  const [docs, setDocs] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (contratos.length === 0) return null;
  async function estatus(id: string, valor: Contrato["estatus"]) {
    const { error } = await supabase.from("legal_contratos").update({ estatus: valor }).eq("id", id);
    if (error) setMsg(error.message);
    else onCambio();
  }
  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Contratos</div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <ul className="space-y-1">
        {contratos.map((k) => (
          <li key={k.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{k.folio}</span>
              <span>{moneda(Number(k.monto))}</span>
              <span className="text-xs text-slate-500">firma {fechaCorta(k.fecha_firma)}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${k.estatus === "firmado" ? "bg-emerald-100 text-emerald-800" : k.estatus === "cancelado" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
                {k.estatus === "firmado" ? `firmado${k.firmado_en ? ` ${fechaCorta(k.firmado_en)}` : ""}` : k.estatus}
              </span>
              <button type="button" onClick={() => abrirContrato({ ...k.datos, folio: k.folio }, "imprimir")} className="text-xs text-sky-700 hover:underline">Imprimir</button>
              <button type="button" onClick={() => abrirContrato({ ...k.datos, folio: k.folio }, "word")} className="text-xs text-sky-700 hover:underline">Word</button>
              {suscripcionPermiteEscribir && k.estatus === "borrador" && (
                <>
                  <button type="button" onClick={() => estatus(k.id, "firmado")} className="text-xs text-emerald-700 hover:underline">Marcar firmado</button>
                  <button type="button" onClick={() => confirm("¿Cancelar este contrato?") && estatus(k.id, "cancelado")} className="text-xs text-red-600 hover:underline">Cancelar</button>
                </>
              )}
              <button type="button" onClick={() => setDocs(docs === k.id ? null : k.id)} className="text-xs text-slate-600 hover:underline">{docs === k.id ? "ocultar escaneado" : "escaneado firmado"}</button>
            </div>
            {docs === k.id && (
              <div className="mt-1 rounded bg-slate-50 p-2">
                <DocumentosLegal destino={{ contrato: k.id }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CAMPOS_MORAL: { k: keyof LegalesCliente; t: string; tipo?: string; ayuda?: string }[] = [
  { k: "constitutiva_numero", t: "Escritura constitutiva: número" },
  { k: "constitutiva_volumen", t: "Volumen" },
  { k: "constitutiva_fecha", t: "Fecha", tipo: "date" },
  { k: "constitutiva_notario", t: "Notario (con título)", ayuda: "Ej. Licenciado Juan Pérez" },
  { k: "constitutiva_notaria", t: "Notaría número" },
  { k: "constitutiva_ciudad", t: "Ciudad de la notaría", ayuda: "Ej. Puebla, Puebla" },
  { k: "registro_lugar", t: "Registro Público de", ayuda: "Ej. Puebla" },
  { k: "registro_numero", t: "Inscrita bajo el número" },
  { k: "registro_tomo", t: "Tomo" },
  { k: "registro_fecha", t: "Fecha de inscripción", tipo: "date" },
  { k: "poder_numero", t: "Poder: escritura número" },
  { k: "poder_volumen", t: "Volumen" },
  { k: "poder_fecha", t: "Fecha", tipo: "date" },
  { k: "poder_notario", t: "Notario (con título)" },
  { k: "poder_notaria", t: "Notaría número" },
  { k: "poder_ciudad", t: "Ciudad de la notaría" },
  { k: "poder_otorgante", t: "Quién otorgó el poder", ayuda: "Ej. el Ingeniero X, en su carácter de Administrador Único de …" },
  { k: "poder_facultades", t: "Facultades", ayuda: "Ej. Poder General para Pleitos y Cobranzas, Actos de Administración…" },
];

function FormCredito({ credito, empresaInicial, onListo }: { credito: Credito | null; empresaInicial: string; onListo: () => void }) {
  const { perfil } = useAuth();
  const autoriza = autorizaCredito(perfil);
  const [empresa, setEmpresa] = useState(credito?.empresa_id ?? empresaInicial);
  const [clienteId, setClienteId] = useState(credito?.cliente_id ?? "");
  const [nuevoCliente, setNuevoCliente] = useState({ razon_social: "", rfc: "" });
  const [f, setF] = useState({
    linea_credito: credito?.linea_credito != null ? String(credito.linea_credito) : "",
    dias_credito: credito?.dias_credito != null ? String(credito.dias_credito) : "",
    interes_moratorio_pct: String(credito?.interes_moratorio_pct ?? 3),
    tipo_persona: credito?.tipo_persona ?? "moral",
    representante_nombre: credito?.representante_nombre ?? "",
    representante_cargo: credito?.representante_cargo ?? "APODERADO LEGAL",
    representante_tratamiento: credito?.representante_tratamiento ?? "EL C.",
    domicilio_legal: credito?.domicilio_legal ?? "",
    correos: credito?.correos ?? "",
    telefonos: credito?.telefonos ?? "",
    obligado_solidario_nombre: credito?.obligado_solidario_nombre ?? "",
    notas: credito?.notas ?? "",
  });
  const [legales, setLegales] = useState<LegalesCliente>(credito?.legales ?? {});
  const [textoLibre, setTextoLibre] = useState(!!(credito?.legales?.constitutiva_texto || credito?.legales?.poder_texto));
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const setL = (k: keyof LegalesCliente, v: string) => setLegales((x) => ({ ...x, [k]: v }));
  const bloqueado = !!credito?.autorizado && !autoriza;

  const { data: clientes } = useQuery({
    enabled: !credito && !!empresa,
    queryKey: ["clientes-empresa", empresa],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("id, razon_social, rfc").eq("empresa_id", empresa).eq("activo", true).order("razon_social");
      if (error) throw error;
      return (data ?? []) as { id: string; razon_social: string; rfc: string | null }[];
    },
  });

  const guardar = useMutation({
    mutationFn: async () => {
      let id = clienteId;
      if (!credito) {
        if (!empresa) throw new Error("Elige la empresa que da el crédito");
        if (!id) {
          if (!nuevoCliente.razon_social.trim()) throw new Error("Elige un cliente o escribe su razón social");
          const { data, error } = await supabase
            .from("clientes")
            .insert({ empresa_id: empresa, razon_social: nuevoCliente.razon_social.trim(), rfc: nuevoCliente.rfc.trim().toUpperCase() || null, domicilio: f.domicilio_legal.trim() || null })
            .select("id")
            .single();
          if (error) throw error;
          id = data.id;
        }
      } else if (credito.clientes && nuevoCliente.rfc.trim()) {
        const { error } = await supabase.from("clientes").update({ rfc: nuevoCliente.rfc.trim().toUpperCase() }).eq("id", credito.cliente_id);
        if (error) throw error;
      }
      const limpios = Object.fromEntries(Object.entries(legales).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, (v as string).trim()]));
      const fila = {
        cliente_id: id,
        empresa_id: empresa,
        linea_credito: f.linea_credito ? Number(f.linea_credito) : null,
        dias_credito: f.dias_credito ? Number(f.dias_credito) : null,
        interes_moratorio_pct: Number(f.interes_moratorio_pct) || 0,
        tipo_persona: f.tipo_persona,
        representante_nombre: f.representante_nombre.trim() || null,
        representante_cargo: f.representante_cargo.trim() || null,
        representante_tratamiento: f.representante_tratamiento.trim() || null,
        domicilio_legal: f.domicilio_legal.trim() || null,
        correos: f.correos.trim() || null,
        telefonos: f.telefonos.trim() || null,
        obligado_solidario_nombre: f.obligado_solidario_nombre.trim() || null,
        legales: limpios,
        notas: f.notas.trim() || null,
      };
      const { error } = credito ? await supabase.from("clientes_credito").update(fila).eq("cliente_id", id) : await supabase.from("clientes_credito").insert(fila);
      if (error) throw error;
    },
    onSuccess: onListo,
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        guardar.mutate();
      }}
      className="space-y-3 rounded border border-slate-200 bg-white p-3"
    >
      <h3 className="text-sm font-semibold text-slate-800">{credito ? `Datos de ${credito.clientes?.razon_social}` : "Crédito a un cliente"}</h3>
      {!credito && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-600">Empresa que da el crédito<SelectorEmpresa value={empresa} onChange={(v) => { setEmpresa(v); setClienteId(""); }} vacio="Elige empresa…" className={inp} required /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Cliente
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={inp}>
              <option value="">— cliente nuevo —</option>
              {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}{c.rfc ? ` · ${c.rfc}` : ""}</option>)}
            </select>
          </label>
          {!clienteId && (
            <>
              <label className="text-xs text-slate-600 sm:col-span-2">Razón social<input value={nuevoCliente.razon_social} onChange={(e) => setNuevoCliente({ ...nuevoCliente, razon_social: e.target.value })} className={inp} placeholder="Ej. RAMSICON, S.A. DE C.V." /></label>
              <label className="text-xs text-slate-600">RFC<input value={nuevoCliente.rfc} onChange={(e) => setNuevoCliente({ ...nuevoCliente, rfc: e.target.value })} className={inp} /></label>
            </>
          )}
        </div>
      )}
      {credito && !credito.clientes?.rfc && (
        <label className="block text-xs text-slate-600">RFC del cliente<input value={nuevoCliente.rfc} onChange={(e) => setNuevoCliente({ ...nuevoCliente, rfc: e.target.value })} className={inp} /></label>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-slate-600">Línea de crédito<input type="number" step="0.01" min="0" value={f.linea_credito} disabled={bloqueado} onChange={(e) => set("linea_credito", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Días de crédito<input type="number" min="0" value={f.dias_credito} disabled={bloqueado} onChange={(e) => set("dias_credito", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Interés moratorio % mensual<input type="number" step="0.01" min="0" value={f.interes_moratorio_pct} disabled={bloqueado} onChange={(e) => set("interes_moratorio_pct", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Persona
          <select value={f.tipo_persona} onChange={(e) => set("tipo_persona", e.target.value)} className={inp}>
            <option value="moral">Moral (empresa)</option>
            <option value="fisica">Física</option>
          </select>
        </label>
      </div>
      {bloqueado && <p className="text-xs text-slate-500">El crédito ya está autorizado: línea, días e interés solo los cambia dirección.</p>}

      <div className="grid gap-2 sm:grid-cols-4">
        {f.tipo_persona === "moral" && (
          <>
            <label className="text-xs text-slate-600 sm:col-span-2">Representante<input value={f.representante_nombre} onChange={(e) => set("representante_nombre", e.target.value)} className={inp} placeholder="MANUEL RAMÍREZ SAINZ" /></label>
            <label className="text-xs text-slate-600">Cargo<input value={f.representante_cargo} onChange={(e) => set("representante_cargo", e.target.value)} className={inp} placeholder="APODERADO LEGAL" /></label>
          </>
        )}
        <label className="text-xs text-slate-600">Tratamiento
          <select value={f.representante_tratamiento} onChange={(e) => set("representante_tratamiento", e.target.value)} className={inp}>
            <option value="EL C.">EL C.</option>
            <option value="LA C.">LA C.</option>
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-4">Domicilio legal y fiscal<input value={f.domicilio_legal} onChange={(e) => set("domicilio_legal", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600 sm:col-span-2">Correos para notificaciones<input value={f.correos} onChange={(e) => set("correos", e.target.value)} className={inp} placeholder="uno@cliente.com ; otro@cliente.com" /></label>
        <label className="text-xs text-slate-600">Teléfonos<input value={f.telefonos} onChange={(e) => set("telefonos", e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-600">Obligado solidario / aval<input value={f.obligado_solidario_nombre} onChange={(e) => set("obligado_solidario_nombre", e.target.value)} className={inp} placeholder="(opcional)" /></label>
      </div>

      {f.tipo_persona === "fisica" ? (
        <label className="block text-xs text-slate-600">Se identifica con<input value={legales.identificacion ?? ""} onChange={(e) => setL("identificacion", e.target.value)} className={inp} placeholder="credencial para votar con clave de elector …" /></label>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={textoLibre} onChange={(e) => setTextoLibre(e.target.checked)} /> Pegar los párrafos tal como los redactó el abogado (en vez de llenar los datos sueltos)
          </label>
          {textoLibre ? (
            <>
              <label className="block text-xs text-slate-600">Párrafo de la escritura constitutiva<textarea rows={3} value={legales.constitutiva_texto ?? ""} onChange={(e) => setL("constitutiva_texto", e.target.value)} className={inp} placeholder="Que “CLIENTE”, S.A. de C.V. es una sociedad mercantil legalmente constituida…" /></label>
              <label className="block text-xs text-slate-600">Párrafo del poder del representante<textarea rows={3} value={legales.poder_texto ?? ""} onChange={(e) => setL("poder_texto", e.target.value)} className={inp} placeholder="Que su apoderado legal, el C. …, cuenta con las facultades suficientes…" /></label>
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-4">
              {CAMPOS_MORAL.map((c) => (
                <label key={c.k} className={`text-xs text-slate-600 ${c.k === "poder_otorgante" || c.k === "poder_facultades" ? "sm:col-span-2" : ""}`}>
                  {c.t}
                  <input type={c.tipo ?? "text"} value={legales[c.k] ?? ""} onChange={(e) => setL(c.k, e.target.value)} className={inp} placeholder={c.ayuda} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <label className="block text-xs text-slate-600">Notas<input value={f.notas} onChange={(e) => set("notas", e.target.value)} className={inp} /></label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{guardar.isPending ? "Guardando…" : "Guardar"}</button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </form>
  );
}
