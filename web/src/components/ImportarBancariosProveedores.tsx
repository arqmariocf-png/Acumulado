import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { filasDesdeTabla, tablaDesdeCsv, type FilaBancaria } from "../lib/importarBancarios";

async function tablaDeArchivo(archivo: File): Promise<(string | null)[][]> {
  if (/\.csv$/i.test(archivo.name) || archivo.type === "text/csv") return tablaDesdeCsv(await archivo.text());
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const tabla: (string | null)[][] = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const celdas: (string | null)[] = [];
    fila.eachCell({ includeEmpty: true }, (celda, col) => {
      celdas[col - 1] = celda.text?.trim() || null;
    });
    tabla.push(celdas);
  });
  return tabla;
}

/** Sube el catálogo de proveedores exportado del backoffice (Excel o CSV) y
 * guarda banco, cuenta, CLABE y RFC de todos de una vez (Mario, 30-sep-2026).
 * Lo capturado a mano en la app no se pisa. */
export function ImportarBancariosProveedores() {
  const { perfil, soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<FilaBancaria[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!perfil || soloConsulta || !["admin", "corporativo", "direccion"].includes(perfil.rol)) return null;

  const importables = (filas ?? []).filter((f) => f.clabe || f.cuenta);
  const conAviso = (filas ?? []).filter((f) => f.error);

  const leer = async (archivo: File | undefined) => {
    setAviso(null);
    setFilas(null);
    if (!archivo) return;
    try {
      const r = filasDesdeTabla(await tablaDeArchivo(archivo));
      if (r.faltaNombre) {
        setAviso("No encontré las columnas. El archivo necesita una columna de proveedor (Proveedor / Nombre / Razón social) y otra de CLABE o Cuenta.");
        return;
      }
      setFilas(r.filas);
    } catch (e) {
      setAviso(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  };

  const importar = async () => {
    setOcupado(true);
    setAviso(null);
    const { data, error } = await supabase.rpc("fn_proveedores_bancarios_importar", {
      p_filas: importables.map(({ nombre, beneficiario, banco, cuenta, clabe, rfc, correo }) => ({ nombre, beneficiario, banco, cuenta, clabe, rfc, correo })),
    });
    setOcupado(false);
    if (error) {
      setAviso(error.message);
      return;
    }
    const r = data as { nuevos: number; actualizados: number; omitidos_captura: number; invalidos: number };
    setAviso(`Listo: ${r.nuevos} nuevos, ${r.actualizados} actualizados${r.omitidos_captura ? `, ${r.omitidos_captura} sin cambio porque ya estaban capturados a mano` : ""}${r.invalidos ? `, ${r.invalidos} rechazados` : ""}.`);
    setFilas(null);
    for (const k of [["tesoreria"], ["pagos-programados"], ["oc-pagos"]]) queryClient.invalidateQueries({ queryKey: k });
  };

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="text-xs text-slate-600 underline">
        Importar datos bancarios de proveedores (Excel del backoffice)
      </button>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-800">Importar catálogo de proveedores</span>
        <input type="file" accept=".xlsx,.csv" onChange={(e) => leer(e.target.files?.[0])} className="text-xs" />
        <button type="button" onClick={() => { setAbierto(false); setFilas(null); setAviso(null); }} className="ml-auto text-slate-500 underline">
          cerrar
        </button>
      </div>
      <p className="mt-1 text-slate-500">Columnas que reconoce: Proveedor, RFC, Banco, Cuenta, CLABE, Beneficiario, Correo. La CLABE se valida con su dígito verificador; los números de tarjeta no se guardan.</p>
      {filas && (
        <div className="mt-2">
          <p className="text-slate-700">
            {importables.length} proveedores con cuenta o CLABE{conAviso.length ? ` · ${conAviso.length} con aviso` : ""}.
          </p>
          <div className="mt-1 max-h-56 overflow-auto rounded border border-slate-100">
            <table className="w-full">
              <tbody>
                {filas.slice(0, 200).map((f, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-0.5">{f.nombre}</td>
                    <td className="px-2 py-0.5">{f.banco ?? ""}</td>
                    <td className="px-2 py-0.5 font-mono">{f.clabe ?? f.cuenta ?? ""}</td>
                    <td className="px-2 py-0.5">{f.rfc ?? ""}</td>
                    <td className="px-2 py-0.5 text-amber-700">{f.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={importar} disabled={ocupado || importables.length === 0} className="mt-2 rounded bg-slate-900 px-3 py-1 font-medium text-white disabled:opacity-50">
            {ocupado ? "Importando…" : `Importar ${importables.length} proveedores`}
          </button>
        </div>
      )}
      {aviso && <p className={`mt-2 ${aviso.startsWith("Listo") ? "text-emerald-700" : "text-red-700"}`}>{aviso}</p>}
    </div>
  );
}
