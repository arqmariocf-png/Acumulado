import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { duplicado, filtrarPorTexto, mensajeBorrado, revisarCliente, type FormCliente } from "../../lib/catalogos";

// Catálogo de clientes (21-oct-2026, Mario: "que puedan ser fácilmente
// manipulables por el área de Laura: agregar, quitar y editar"). Son los
// mismos clientes del cotizador, las OV, el punto de venta, el CRM y crédito
// y contratos de legal: cada uno pertenece a una empresa, pero el cotizador
// los ofrece a todas. Quitar = borrar si no se ha usado; si ya tiene
// cotizaciones, ventas, crédito o contrato, se desactiva.

interface Cliente {
  id: string;
  empresa_id: string;
  razon_social: string;
  nombre_comercial: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  codigo_postal: string | null;
  domicilio: string | null;
  email: string | null;
  telefono: string | null;
  notas: string | null;
  activo: boolean;
}

const COLUMNAS = "id, empresa_id, razon_social, nombre_comercial, rfc, regimen_fiscal, codigo_postal, domicilio, email, telefono, notas, activo";
const campo = "mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function aForm(c: Cliente): FormCliente {
  return {
    empresa_id: c.empresa_id,
    razon_social: c.razon_social,
    nombre_comercial: c.nombre_comercial ?? "",
    rfc: c.rfc ?? "",
    regimen_fiscal: c.regimen_fiscal ?? "",
    codigo_postal: c.codigo_postal ?? "",
    domicilio: c.domicilio ?? "",
    email: c.email ?? "",
    telefono: c.telefono ?? "",
    notas: c.notas ?? "",
  };
}

export function CatalogoClientes() {
  const { soloConsulta, empresaActiva } = useAuth();
  const empresas = useEmpresasAlcance();
  const [texto, setTexto] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [editando, setEditando] = useState<Cliente | "nuevo" | null>(null);

  const clientes = useQuery({
    queryKey: ["catalogo-clientes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select(COLUMNAS).order("razon_social");
      if (error) throw error;
      return (data ?? []) as Cliente[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas.data ?? []).map((e) => [e.id, e.codigo])), [empresas.data]);

  const lista = useMemo(
    () =>
      filtrarPorTexto(
        (clientes.data ?? []).filter((c) => (inactivos || c.activo) && (!empresaId || c.empresa_id === empresaId)),
        texto,
        (c) => [c.razon_social, c.nombre_comercial, c.rfc, c.telefono, c.email],
      ),
    [clientes.data, texto, empresaId, inactivos],
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Clientes</h1>
      <p className="mb-4 max-w-3xl text-sm text-slate-500">
        Los clientes registrados con sus datos fiscales y de contacto. Salen en el cotizador, las órdenes de venta, el punto de venta, el CRM y en crédito y
        contratos. Si un cliente ya se usó no se puede borrar: se desactiva y deja de salir en los buscadores.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Buscar
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, RFC, teléfono…" className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Empresa
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            {(empresas.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} · {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 pb-2 text-xs text-slate-600">
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> ver desactivados
        </label>
        {!soloConsulta && (
          <button type="button" onClick={() => setEditando("nuevo")} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            + Nuevo cliente
          </button>
        )}
      </div>

      {editando && (
        <EditorCliente
          cliente={editando === "nuevo" ? null : editando}
          clientes={clientes.data ?? []}
          empresaSugerida={empresaId || empresaActiva || ""}
          onCerrar={() => setEditando(null)}
        />
      )}

      {clientes.error && <p className="mb-3 text-sm text-red-600">{(clientes.error as Error).message}</p>}
      {clientes.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">RFC</th>
                <th className="px-3 py-2">Contacto</th>
                <th className="px-3 py-2">Domicilio</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    {(clientes.data ?? []).length === 0 ? 'Todavía no hay clientes. Da de alta el primero con "+ Nuevo cliente".' : "Sin coincidencias."}
                  </td>
                </tr>
              )}
              {lista.map((c) => (
                <tr key={c.id} className={`border-t border-slate-100 align-top ${c.activo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.razon_social}</div>
                    {c.nombre_comercial && <div className="text-xs text-slate-500">{c.nombre_comercial}</div>}
                    {!c.activo && <span className="text-xs">(desactivado)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{nombreEmpresa.get(c.empresa_id) ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.rfc ?? <span className="text-amber-700">sin RFC</span>}</td>
                  <td className="px-3 py-2 text-xs">{[c.telefono, c.email].filter(Boolean).join(" · ") || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{[c.domicilio, c.codigo_postal && `C.P. ${c.codigo_postal}`].filter(Boolean).join(", ") || <span className="text-slate-400">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {!soloConsulta && (
                      <button type="button" onClick={() => setEditando(c)} className="text-xs text-sky-700 underline">
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

function EditorCliente({ cliente, clientes, empresaSugerida, onCerrar }: { cliente: Cliente | null; clientes: Cliente[]; empresaSugerida: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const { perfil } = useAuth();
  const empresas = useEmpresasAlcance();
  const [f, setF] = useState<FormCliente>(
    cliente
      ? aForm(cliente)
      : { empresa_id: empresaSugerida, razon_social: "", nombre_comercial: "", rfc: "", regimen_fiscal: "", codigo_postal: "", domicilio: "", email: "", telefono: "", notas: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const puedeBorrar = perfil?.rol === "admin" || perfil?.rol === "direccion";
  const dup = useMemo(
    () => duplicado(clientes.map((c) => ({ id: c.id, nombre: c.razon_social, rfc: c.rfc })), f.razon_social, f.rfc, cliente?.id),
    [clientes, f.razon_social, f.rfc, cliente?.id],
  );

  const invalidar = () => {
    for (const k of ["catalogo-clientes", "cotizador-datos", "ordenes-ia-catalogo", "cotizador-productos", "clientes"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const cerrarTras = { onSuccess: () => (invalidar(), onCerrar()), onError: (e: Error) => setError(e.message) };
  const guardar = useMutation({
    mutationFn: async () => {
      const problema = revisarCliente(f);
      if (problema) throw new Error(problema);
      const t = (v: string) => v.trim() || null;
      const fila = {
        empresa_id: f.empresa_id,
        razon_social: f.razon_social.trim(),
        nombre_comercial: t(f.nombre_comercial),
        rfc: t(f.rfc.toUpperCase()),
        regimen_fiscal: t(f.regimen_fiscal),
        codigo_postal: t(f.codigo_postal),
        domicilio: t(f.domicilio),
        email: t(f.email),
        telefono: t(f.telefono),
        notas: t(f.notas),
      };
      const { error } = cliente ? await supabase.from("clientes").update(fila).eq("id", cliente.id) : await supabase.from("clientes").insert(fila);
      if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Ya hay un cliente con ese RFC o nombre en esa empresa." : error.message);
    },
    ...cerrarTras,
  });
  const activar = useMutation({
    mutationFn: async (activo: boolean) => {
      const { error } = await supabase.from("clientes").update({ activo }).eq("id", cliente!.id);
      if (error) throw error;
    },
    ...cerrarTras,
  });
  const borrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("clientes").delete().eq("id", cliente!.id).select("id");
      if (error) throw new Error(mensajeBorrado(error, "el cliente"));
      if (!data?.length) throw new Error("No tienes permiso para borrar este cliente; desactívalo.");
    },
    ...cerrarTras,
  });

  const entrada = (k: keyof FormCliente, etiqueta: string, extra: { className?: string; placeholder?: string; mono?: boolean } = {}) => (
    <label className={`text-xs text-slate-600 ${extra.className ?? ""}`}>
      {etiqueta}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={extra.placeholder} className={`${campo} ${extra.mono ? "font-mono uppercase" : ""}`} />
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
      <p className="text-sm font-medium text-slate-800 sm:col-span-6">{cliente ? `Editar ${cliente.razon_social}` : "Nuevo cliente"}</p>
      {entrada("razon_social", "Razón social o nombre", { className: "sm:col-span-3", placeholder: "Ej. RAMSICON, S.A. DE C.V." })}
      <label className="text-xs text-slate-600 sm:col-span-1">
        Empresa
        <select value={f.empresa_id} onChange={(e) => setF({ ...f, empresa_id: e.target.value })} className={campo}>
          <option value="">Elige…</option>
          {(empresas.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.codigo} · {e.nombre}
            </option>
          ))}
        </select>
      </label>
      {entrada("rfc", "RFC", { mono: true, className: "sm:col-span-1" })}
      {entrada("regimen_fiscal", "Régimen fiscal", { className: "sm:col-span-1", placeholder: "601, 612…" })}
      {entrada("nombre_comercial", "Nombre comercial", { className: "sm:col-span-2" })}
      {entrada("telefono", "Teléfono", { className: "sm:col-span-2" })}
      {entrada("email", "Correo", { className: "sm:col-span-2" })}
      {entrada("domicilio", "Domicilio", { className: "sm:col-span-5" })}
      {entrada("codigo_postal", "C.P.", { className: "sm:col-span-1" })}
      {entrada("notas", "Notas", { className: "sm:col-span-6", placeholder: "Condiciones, contacto de compras, horarios de entrega…" })}
      {dup && <p className="text-xs text-amber-700 sm:col-span-6">Ojo: ya existe {dup.nombre} con ese nombre o RFC.</p>}
      {error && <p className="text-xs text-red-700 sm:col-span-6">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-6">
        <button disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCerrar} className="px-2 text-sm text-slate-600 underline">
          Cancelar
        </button>
        {cliente && (
          <span className="ml-auto flex gap-3">
            <button type="button" onClick={() => activar.mutate(!cliente.activo)} className="text-xs text-red-700 underline">
              {cliente.activo ? "Desactivar" : "Reactivar"}
            </button>
            {puedeBorrar && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Borrar a ${cliente.razon_social}? Solo se puede si no se ha usado.`)) borrar.mutate();
                }}
                className="text-xs text-red-700 underline"
              >
                Borrar
              </button>
            )}
          </span>
        )}
      </div>
    </form>
  );
}
