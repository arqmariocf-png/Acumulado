import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Pestana = "estado_cuenta" | "cfdi" | "oc_ov";

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "estado_cuenta", etiqueta: "Estado de cuenta" },
  { valor: "cfdi", etiqueta: "CFDI" },
  { valor: "oc_ov", etiqueta: "Catálogo OC/OV (Excel)" },
];

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useCuentas(empresaId: string) {
  return useQuery({
    queryKey: ["cuentas", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4").eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });
}

async function llamarFuncion(nombre: string, formData: FormData) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const respuesta = await fetch(urlFuncion(nombre), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
  return json;
}

export function Carga() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [pestana, setPestana] = useState<Pestana>("estado_cuenta");
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { data: cuentas } = useCuentas(empresaId);

  async function onSubmitEstadoCuenta(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResultado(null);
    setEnviando(true);
    try {
      const form = new FormData(e.currentTarget);
      const json = await llamarFuncion("ingesta-estado-cuenta", form);
      setResultado(json);
      if (json.archivoId) {
        // Dispara la clasificación automáticamente tras una ingesta exitosa.
        const { data: sessionData } = await supabase.auth.getSession();
        await fetch(urlFuncion("motor-conciliacion"), {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ empresaId, archivoId: json.archivoId }),
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function onSubmitGenerico(nombreFuncion: string) {
    return async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setResultado(null);
      setEnviando(true);
      try {
        const form = new FormData(e.currentTarget);
        const json = await llamarFuncion(nombreFuncion, form);
        setResultado(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setEnviando(false);
      }
    };
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Carga de archivos</h1>

      <div className="mb-4 flex gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.valor}
            onClick={() => {
              setPestana(p.valor);
              setResultado(null);
              setError(null);
            }}
            className={`rounded px-3 py-1.5 text-sm ${pestana === p.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"} border border-slate-200`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="mb-4">
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}
      </div>

      {pestana === "estado_cuenta" && empresaId && (
        <form onSubmit={onSubmitEstadoCuenta} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Cuenta bancaria</label>
            <select name="cuentaId" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Selecciona…</option>
              {cuentas?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.banco} ····{c.ultimos_4}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo (CSV o Excel, formato canónico)</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar y clasificar"}
          </button>
        </form>
      )}

      {pestana === "cfdi" && empresaId && (
        <form onSubmit={onSubmitGenerico("ingesta-cfdi")} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
            <select name="tipo" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="recibido">Recibidos (compras)</option>
              <option value="emitido">Emitidos (ventas)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">RFC de la empresa</label>
            <input name="rfc" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Periodo (AAAAMM)</label>
            <input name="periodo" required pattern="\d{6}" placeholder="202607" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar CFDI"}
          </button>
        </form>
      )}

      {pestana === "oc_ov" && empresaId && (
        <form onSubmit={onSubmitGenerico("ingesta-oc-ov")} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Catálogo</label>
            <select name="recurso" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="oc">Órdenes de Compra/Servicio</option>
              <option value="ov">Órdenes de Venta</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <p className="text-xs text-slate-500">
            Carga de respaldo mientras se confirma la integración directa con la API del backoffice.
          </p>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar catálogo"}
          </button>
        </form>
      )}

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para continuar.</p>}

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}
      {resultado && (
        <pre className="mt-4 max-w-2xl overflow-x-auto rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
          {JSON.stringify(resultado, null, 2)}
        </pre>
      )}
    </div>
  );
}
