import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { ETIQUETA_TIPO_PAGO, type TipoPago } from "../../lib/hojaPagos";

// Programación de pagos de Laura (8-oct-2026): debajo de las órdenes de
// compra, préstamos o traspasos entre empresas y/o cuentas, y nómina fiscal /
// mano de obra. Todo se guarda en pagos_programados con su tipo y entra a la
// hoja de pagos del día: cargo en la empresa que paga y, en traspasos y
// préstamos, abono en la que recibe.

interface Cuenta {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
}

interface Movimiento {
  id: string;
  empresa_id: string;
  cuenta_id: string | null;
  destino_empresa_id: string | null;
  destino_cuenta_id: string | null;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  estatus: "pendiente" | "pagado" | "cancelado";
  tipo: TipoPago;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

function fechaCorta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
}

export function TraspasosNomina({
  modo,
  empresas,
  cuentas,
  hoy,
  filtroEmpresa,
}: {
  modo: "traspasos" | "nomina";
  empresas: { id: string; nombre: string }[];
  cuentas: Cuenta[];
  hoy: string;
  filtroEmpresa: string;
}) {
  const qc = useQueryClient();
  const tipos: TipoPago[] = modo === "traspasos" ? ["traspaso", "prestamo"] : ["nomina", "mano_obra"];
  const [tipo, setTipo] = useState<TipoPago>(tipos[0]);
  const [empresa, setEmpresa] = useState(filtroEmpresa);
  const [destino, setDestino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nombre = new Map(empresas.map((e) => [e.id, e.nombre]));
  const textoCuenta = (id: string | null) => {
    const c = cuentas.find((x) => x.id === id);
    return c ? `${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}` : "";
  };

  const { data } = useQuery({
    queryKey: ["pagos-programados", "tipo", modo],
    queryFn: async () => {
      const { data: filas, error: err } = await supabase
        .from("pagos_programados")
        .select("id, empresa_id, cuenta_id, destino_empresa_id, destino_cuenta_id, beneficiario, concepto, monto, fecha_programada, estatus, tipo")
        .in("tipo", tipos)
        .neq("estatus", "cancelado")
        .gte("fecha_programada", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
        .order("fecha_programada", { ascending: false })
        .limit(200);
      if (err) throw err;
      return (filas ?? []) as Movimiento[];
    },
  });
  const lista = (data ?? []).filter((m) => !filtroEmpresa || m.empresa_id === filtroEmpresa || m.destino_empresa_id === filtroEmpresa);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["pagos-programados"] });

  const crear = useMutation({
    mutationFn: async (fd: FormData) => {
      const empresaId = String(fd.get("empresa_id") ?? "");
      const cuentaId = String(fd.get("cuenta_id") ?? "") || null;
      const monto = Number(fd.get("monto"));
      const fecha = String(fd.get("fecha_programada") ?? hoy);
      const concepto = String(fd.get("concepto") ?? "").trim() || null;
      if (!empresaId) throw new Error("Elige la empresa que paga.");
      if (!(monto > 0)) throw new Error("Escribe el monto.");
      let fila: Record<string, unknown>;
      if (modo === "traspasos") {
        const destinoEmpresa = String(fd.get("destino_empresa_id") ?? "");
        const destinoCuenta = String(fd.get("destino_cuenta_id") ?? "") || null;
        if (!destinoEmpresa) throw new Error("Elige la empresa que recibe.");
        if (destinoEmpresa === empresaId && (!cuentaId || !destinoCuenta || cuentaId === destinoCuenta)) {
          throw new Error("Para un traspaso dentro de la misma empresa elige la cuenta de salida y una cuenta destino distinta.");
        }
        const destinoTexto = `${nombre.get(destinoEmpresa) ?? ""}${destinoCuenta ? ` ${textoCuenta(destinoCuenta)}` : ""}`.trim();
        fila = {
          empresa_id: empresaId,
          cuenta_id: cuentaId,
          destino_empresa_id: destinoEmpresa,
          destino_cuenta_id: destinoCuenta,
          beneficiario: `${tipo === "prestamo" ? "PRÉSTAMO A" : "TRASPASO A"} ${destinoTexto}`.toUpperCase(),
          concepto,
        };
      } else {
        fila = {
          empresa_id: empresaId,
          cuenta_id: cuentaId,
          beneficiario: tipo === "nomina" ? "NÓMINA FISCAL" : "MANO DE OBRA",
          concepto,
        };
      }
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase
        .from("pagos_programados")
        .insert({ ...fila, tipo, monto, fecha_programada: fecha, metodo: "transferencia", estatus: "pendiente", created_by: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  const actualizar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Record<string, unknown> }) => {
      const { error: err } = await supabase.from("pagos_programados").update(cambios).eq("id", id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    crear.mutate(new FormData(form), {
      onSuccess: () => {
        form.reset();
        setDestino("");
      },
    });
  }

  const cuentasDe = (id: string) => cuentas.filter((c) => c.empresa_id === id);
  const titulo = modo === "traspasos" ? "Préstamos y traspasos entre empresas o cuentas" : "Nómina fiscal y mano de obra";
  const ayuda =
    modo === "traspasos"
      ? "Sale de la empresa y cuenta que paga (cargo) y entra a la que recibe (abono) en la hoja de pagos del día."
      : "Sale de la empresa y cuenta que paga; se descuenta en la hoja de pagos del día.";

  return (
    <section id={modo} className="mb-4 scroll-mt-20 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
      <p className="mb-3 text-xs text-slate-500">{ayuda}</p>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <div>
          <label className={etiqueta}>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPago)} className={campo}>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_PAGO[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Empresa que paga</label>
          <select name="empresa_id" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={campo}>
            <option value="">Elige…</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Cuenta de salida</label>
          <select name="cuenta_id" className={campo} defaultValue="">
            <option value="">Por definir</option>
            {cuentasDe(empresa).map((c) => (
              <option key={c.id} value={c.id}>
                {c.banco} {c.ultimos_4}
              </option>
            ))}
          </select>
        </div>
        {modo === "traspasos" && (
          <>
            <div>
              <label className={etiqueta}>Empresa que recibe</label>
              <select name="destino_empresa_id" value={destino} onChange={(e) => setDestino(e.target.value)} className={campo}>
                <option value="">Elige…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Cuenta destino</label>
              <select name="destino_cuenta_id" className={campo} defaultValue="">
                <option value="">Por definir</option>
                {cuentasDe(destino).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.banco} {c.ultimos_4}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label className={etiqueta}>Monto</label>
          <input name="monto" type="number" step="0.01" min="0.01" className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Fecha</label>
          <input name="fecha_programada" type="date" defaultValue={hoy} className={campo} />
        </div>
        <div className={modo === "traspasos" ? "" : "sm:col-span-2 lg:col-span-3"}>
          <label className={etiqueta}>{modo === "traspasos" ? "Concepto" : "Concepto (semana, obra…)"}</label>
          <input name="concepto" className={campo} />
        </div>
        <div className="flex items-end">
          <button disabled={crear.isPending} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {crear.isPending ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </form>
      {error && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {lista.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 pr-2">Fecha</th>
              <th className="pr-2">Tipo</th>
              <th className="pr-2">Sale de</th>
              {modo === "traspasos" && <th className="pr-2">Entra a</th>}
              <th className="pr-2">Concepto</th>
              <th className="pr-2 text-right">Monto</th>
              <th className="pr-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id} className={`border-t border-slate-100 ${m.estatus === "pagado" ? "text-slate-400" : ""}`}>
                <td className="whitespace-nowrap py-1.5 pr-2">{fechaCorta(m.fecha_programada)}</td>
                <td className="pr-2">{ETIQUETA_TIPO_PAGO[m.tipo]}</td>
                <td className="pr-2">
                  {nombre.get(m.empresa_id)}
                  {m.cuenta_id && <div className="text-xs text-slate-500">{textoCuenta(m.cuenta_id)}</div>}
                </td>
                {modo === "traspasos" && (
                  <td className="pr-2">
                    {m.destino_empresa_id ? nombre.get(m.destino_empresa_id) : "—"}
                    {m.destino_cuenta_id && <div className="text-xs text-slate-500">{textoCuenta(m.destino_cuenta_id)}</div>}
                  </td>
                )}
                <td className="pr-2 text-xs text-slate-600">{m.concepto ?? ""}</td>
                <td className="pr-2 text-right tabular-nums">{moneda(Number(m.monto))}</td>
                <td className="whitespace-nowrap pr-2 text-right text-xs">
                  {m.estatus === "pendiente" ? (
                    <>
                      <button onClick={() => actualizar.mutate({ id: m.id, cambios: { estatus: "pagado", pagado_en: hoy } })} className="mr-2 text-emerald-700 underline">
                        Hecho
                      </button>
                      <button onClick={() => window.confirm("¿Cancelar este movimiento?") && actualizar.mutate({ id: m.id, cambios: { estatus: "cancelado" } })} className="text-slate-500 underline">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <span>hecho</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
