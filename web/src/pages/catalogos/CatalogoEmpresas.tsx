import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { duplicado, filtrarPorTexto, revisarEmpresa, type FormEmpresa } from "../../lib/catalogos";
import { LOGO_MAXIMO, TIPOS_LOGO, logoValido, medidasLogo } from "../../lib/logoEmpresa";
import { olvidarLogos } from "../../lib/logoEmpresaCargar";

// Catálogo de empresas (21-oct-2026, Mario: "que puedan ser fácilmente
// manipulables por el área de Laura: agregar, quitar y editar"). Dirección y
// el admin dan de alta y editan las razones sociales de su organización con
// los datos que salen impresos (membrete y cuenta para depósito). No se
// borran: se desactivan. El código solo lo cambia el admin una vez dado de
// alta (trigger empresas_guarda_codigo).

interface EmpresaFicha {
  id: string;
  nombre: string;
  codigo: string;
  rfc: string | null;
  activo: boolean;
  razon_social: string | null;
  domicilio_fiscal: string | null;
  telefono: string | null;
  correo: string | null;
  banco: string | null;
  cuenta_bancaria: string | null;
  clabe: string | null;
  sucursal_bancaria: string | null;
  logo: string | null;
}

const COLUMNAS = "id, nombre, codigo, rfc, activo, razon_social, domicilio_fiscal, telefono, correo, banco, cuenta_bancaria, clabe, sucursal_bancaria, logo";
const campo = "mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const VACIA: FormEmpresa = { nombre: "", codigo: "", rfc: "", razon_social: "", domicilio_fiscal: "", telefono: "", correo: "", banco: "", cuenta_bancaria: "", clabe: "", sucursal_bancaria: "" };

function aForm(e: EmpresaFicha): FormEmpresa {
  return {
    nombre: e.nombre,
    codigo: e.codigo,
    rfc: e.rfc ?? "",
    razon_social: e.razon_social ?? "",
    domicilio_fiscal: e.domicilio_fiscal ?? "",
    telefono: e.telefono ?? "",
    correo: e.correo ?? "",
    banco: e.banco ?? "",
    cuenta_bancaria: e.cuenta_bancaria ?? "",
    clabe: e.clabe ?? "",
    sucursal_bancaria: e.sucursal_bancaria ?? "",
  };
}

export function CatalogoEmpresas() {
  const { soloConsulta } = useAuth();
  const [texto, setTexto] = useState("");
  const [inactivas, setInactivas] = useState(false);
  const [editando, setEditando] = useState<EmpresaFicha | "nueva" | null>(null);

  const empresas = useQuery({
    queryKey: ["catalogo-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select(COLUMNAS).order("nombre");
      if (error) throw error;
      return (data ?? []) as EmpresaFicha[];
    },
  });

  const lista = useMemo(
    () =>
      filtrarPorTexto(
        (empresas.data ?? []).filter((e) => inactivas || e.activo),
        texto,
        (e) => [e.nombre, e.codigo, e.rfc, e.razon_social],
      ),
    [empresas.data, texto, inactivas],
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Empresas</h1>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Las razones sociales del grupo con los datos que salen impresos en órdenes, cotizaciones y remisiones: razón social, RFC, domicilio fiscal, teléfono,
        correo y la cuenta para depósito. Una empresa no se borra (cuelga de todo): se desactiva.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Buscar
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, código o RFC" className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1 pb-2 text-xs text-slate-600">
          <input type="checkbox" checked={inactivas} onChange={(e) => setInactivas(e.target.checked)} /> ver desactivadas
        </label>
        {!soloConsulta && (
          <button type="button" onClick={() => setEditando("nueva")} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            + Nueva empresa
          </button>
        )}
      </div>

      {editando && <EditorEmpresa empresa={editando === "nueva" ? null : editando} empresas={empresas.data ?? []} onCerrar={() => setEditando(null)} />}

      {empresas.error && <p className="mb-3 text-sm text-red-600">{(empresas.error as Error).message}</p>}
      {empresas.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Logo</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">RFC</th>
                <th className="px-3 py-2">Contacto</th>
                <th className="px-3 py-2">Cuenta para depósito</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Sin coincidencias.
                  </td>
                </tr>
              )}
              {lista.map((e) => (
                <tr key={e.id} className={`border-t border-slate-100 align-top ${e.activo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    {e.logo ? <img src={e.logo} alt="" className="h-8 max-w-[96px] object-contain" /> : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{e.codigo}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{e.nombre}</div>
                    {e.razon_social && e.razon_social !== e.nombre && <div className="text-xs text-slate-500">{e.razon_social}</div>}
                    {!e.activo && <span className="text-xs">(desactivada)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.rfc ?? <span className="text-amber-700">sin RFC</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {[e.telefono, e.correo].filter(Boolean).join(" · ") || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.clabe ? (
                      <>
                        {e.banco ?? "Banco"} · CLABE <span className="font-mono">{e.clabe}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!soloConsulta && (
                      <button type="button" onClick={() => setEditando(e)} className="text-xs text-sky-700 underline">
                        editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EditorEmpresa({ empresa, empresas, onCerrar }: { empresa: EmpresaFicha | null; empresas: EmpresaFicha[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const { grupo, perfil } = useAuth();
  const [f, setF] = useState<FormEmpresa>(empresa ? aForm(empresa) : VACIA);
  const [error, setError] = useState<string | null>(null);
  const puedeCambiarCodigo = !empresa || perfil?.rol === "admin";
  const dup = useMemo(
    () => duplicado(empresas.map((e) => ({ id: e.id, nombre: e.nombre, rfc: e.rfc })), f.nombre, f.rfc, empresa?.id),
    [empresas, f.nombre, f.rfc, empresa?.id],
  );
  const codigoRepetido = empresas.find((e) => e.id !== empresa?.id && e.codigo.toUpperCase() === f.codigo.trim().toUpperCase());

  const invalidar = () => {
    for (const k of ["catalogo-empresas", "admin-empresas", "empresas", "empresas-alcance", "inicio-empresas"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const problema = revisarEmpresa(f);
      if (problema) throw new Error(problema);
      if (codigoRepetido) throw new Error(`El código ${codigoRepetido.codigo} ya es de ${codigoRepetido.nombre}.`);
      const t = (v: string) => v.trim() || null;
      const fila = {
        nombre: f.nombre.trim(),
        rfc: t(f.rfc.toUpperCase()),
        razon_social: t(f.razon_social),
        domicilio_fiscal: t(f.domicilio_fiscal),
        telefono: t(f.telefono),
        correo: t(f.correo),
        banco: t(f.banco),
        cuenta_bancaria: t(f.cuenta_bancaria.replace(/\s/g, "")),
        clabe: t(f.clabe.replace(/\s/g, "")),
        sucursal_bancaria: t(f.sucursal_bancaria),
        ...(puedeCambiarCodigo ? { codigo: f.codigo.trim().toUpperCase() } : {}),
      };
      if (empresa) {
        const { error } = await supabase.from("empresas").update(fila).eq("id", empresa.id);
        if (error) throw error;
      } else {
        if (!grupo) throw new Error("Tu usuario no tiene organización asignada.");
        const { error } = await supabase.from("empresas").insert({ ...fila, grupo_id: grupo.id });
        if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ya hay una empresa con ese código." : error.message);
      }
    },
    onSuccess: () => {
      invalidar();
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });
  const activar = useMutation({
    mutationFn: async (activo: boolean) => {
      const { error } = await supabase.from("empresas").update({ activo }).eq("id", empresa!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      onCerrar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const entrada = (k: keyof FormEmpresa, etiqueta: string, extra: { className?: string; placeholder?: string; mono?: boolean; disabled?: boolean } = {}) => (
    <label className={`text-xs text-slate-600 ${extra.className ?? ""}`}>
      {etiqueta}
      <input
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        placeholder={extra.placeholder}
        disabled={extra.disabled}
        className={`${campo} ${extra.mono ? "font-mono uppercase" : ""} disabled:bg-slate-100`}
      />
    </label>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        guardar.mutate();
      }}
      className="mb-4 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6"
    >
      <p className="text-sm font-medium text-slate-800 sm:col-span-6">{empresa ? `Editar ${empresa.codigo} · ${empresa.nombre}` : "Nueva empresa"}</p>
      {entrada("nombre", "Nombre corto", { className: "sm:col-span-2", placeholder: "Ej. Clavicón" })}
      {entrada("codigo", "Código", { mono: true, placeholder: "MCC", disabled: !puedeCambiarCodigo })}
      {entrada("rfc", "RFC", { mono: true, className: "sm:col-span-1" })}
      {entrada("telefono", "Teléfono", { className: "sm:col-span-1" })}
      {entrada("correo", "Correo", { className: "sm:col-span-1" })}
      {entrada("razon_social", "Razón social (como sale impresa)", { className: "sm:col-span-3", placeholder: "Ej. MATERIALES Y CLAVOS DE CHOLULA, S.A. DE C.V." })}
      {entrada("domicilio_fiscal", "Domicilio fiscal", { className: "sm:col-span-3" })}
      {entrada("banco", "Banco", { className: "sm:col-span-1" })}
      {entrada("sucursal_bancaria", "Sucursal", { className: "sm:col-span-1" })}
      {entrada("cuenta_bancaria", "Cuenta", { mono: true, className: "sm:col-span-2" })}
      {entrada("clabe", "CLABE (18 dígitos)", { mono: true, className: "sm:col-span-2" })}
      {empresa && <LogoEmpresa empresa={empresa} onCambio={invalidar} />}
      {!puedeCambiarCodigo && <p className="text-xs text-slate-500 sm:col-span-6">El código se usa en cargas, folios y logos: solo el director general lo cambia.</p>}
      {dup && <p className="text-xs text-amber-700 sm:col-span-6">Ojo: ya existe {dup.nombre} con ese nombre o RFC.</p>}
      {error && <p className="text-xs text-red-700 sm:col-span-6">{error}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-6">
        <button disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCerrar} className="px-2 text-sm text-slate-600 underline">
          Cancelar
        </button>
        {empresa && (
          <button
            type="button"
            onClick={() => {
              if (!empresa.activo || window.confirm(`¿Desactivar ${empresa.nombre}? Ya no saldrá para elegir en las pantallas; lo capturado se conserva.`)) activar.mutate(!empresa.activo);
            }}
            className="ml-auto text-xs text-red-700 underline"
          >
            {empresa.activo ? "Desactivar" : "Reactivar"}
          </button>
        )}
      </div>
    </form>
  );
}

/** Reduce la imagen a la caja del logo (PNG para conservar transparencia; si
 * queda muy pesada, JPEG sobre blanco). */
async function prepararLogo(archivo: File): Promise<string> {
  if (!(TIPOS_LOGO as readonly string[]).includes(archivo.type)) throw new Error("Sube una imagen PNG, JPG o WEBP.");
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No se pudo leer la imagen."));
      i.src = url;
    });
    const m = medidasLogo(img.naturalWidth, img.naturalHeight);
    if (!m.ancho) throw new Error("La imagen está vacía.");
    const lienzo = document.createElement("canvas");
    lienzo.width = m.ancho;
    lienzo.height = m.alto;
    const ctx = lienzo.getContext("2d")!;
    ctx.drawImage(img, 0, 0, m.ancho, m.alto);
    let dato = lienzo.toDataURL("image/png");
    if (dato.length > LOGO_MAXIMO) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, m.ancho, m.alto);
      dato = lienzo.toDataURL("image/jpeg", 0.85);
    }
    if (!logoValido(dato)) throw new Error("La imagen sigue muy pesada; usa una más sencilla.");
    return dato;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LogoEmpresa({ empresa, onCambio }: { empresa: EmpresaFicha; onCambio: () => void }) {
  const [logo, setLogo] = useState<string | null>(empresa.logo);
  const [aviso, setAviso] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async (nuevo: string | null) => {
      const { error } = await supabase.from("empresas").update({ logo: nuevo, logo_actualizado_en: new Date().toISOString() }).eq("id", empresa.id);
      if (error) throw error;
      return nuevo;
    },
    onSuccess: (nuevo) => {
      setLogo(nuevo);
      setAviso(nuevo ? "Logo guardado: ya sale en cotizaciones, órdenes, remisiones, requisiciones y tickets de esta empresa." : "Logo quitado.");
      olvidarLogos();
      onCambio();
    },
    onError: (e: Error) => setAviso(e.message),
  });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-2 sm:col-span-6">
      <span className="text-xs font-medium text-slate-700">Logo para documentos</span>
      {logo ? <img src={logo} alt="" className="h-12 max-w-[200px] object-contain" /> : <span className="text-xs text-slate-400">sin logo (se usa el de siempre si existe)</span>}
      <label className="cursor-pointer rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">
        {logo ? "Cambiar imagen" : "Subir imagen"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            if (!archivo) return;
            setAviso(null);
            try {
              guardar.mutate(await prepararLogo(archivo));
            } catch (err) {
              setAviso((err as Error).message);
            }
          }}
        />
      </label>
      {logo && (
        <button type="button" onClick={() => guardar.mutate(null)} className="text-xs text-red-700 underline">
          Quitar
        </button>
      )}
      {guardar.isPending && <span className="text-xs text-slate-500">Guardando…</span>}
      {aviso && <span className="text-xs text-slate-600">{aviso}</span>}
      <span className="w-full text-[11px] text-slate-500">PNG con fondo transparente se ve mejor. Se ajusta solo a 600 × 240 px.</span>
    </div>
  );
}
