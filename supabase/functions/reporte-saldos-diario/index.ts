// Edge function: genera el PDF "Grupo Loma -- Saldos Bancarios" (posición
// global + entradas/salidas de ayer y de hoy, por cuenta bancaria) que
// tesorería sube para poder programar los pagos/compras (OS/OV) cargados en
// el backoffice. Ver _shared/reportes/saldos.ts (shaping puro, probado) y
// _shared/reportes/pdf-saldos.ts (dibujo del PDF con npm:pdf-lib).
//
// POST sin body. Devuelve el PDF binario directo (Content-Type
// application/pdf), no JSON -- a diferencia del resto de funciones de este
// proyecto, así que el frontend debe leerlo como blob, no como JSON.
//
// Es un reporte consolidado de las 8 empresas, así que solo se expone a
// roles que ya ven todas las empresas por RLS (corporativo/admin, o
// cualquier perfil sin empresa_id asignada, ej. dirección) -- un rol
// "empresa" recibiría un PDF con una sola empresa por las policies de
// cuentas_bancarias/movimientos, lo cual sería confuso presentado como
// reporte "Grupo Loma", así que se rechaza antes de generarlo.

import { clienteComoUsuario, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { corsHeaders, respuestaCors } from "../_shared/cors.ts";
import { construirReporteSaldosDia, type FilaSaldoCuenta } from "../_shared/reportes/saldos.ts";
import { generarPdfSaldosDiarios } from "../_shared/reportes/pdf-saldos.ts";

function jsonError(mensaje: string, status: number): Response {
  return new Response(JSON.stringify({ error: mensaje }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function veTodasLasEmpresas(perfil: { rol: string; empresaId: string | null }): boolean {
  return perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresaId === null;
}

/** yyyy-mm-dd de "hoy"/"ayer" en horario de Ciudad de México, sin depender
 * de en qué zona horaria corra el runtime del edge function. */
function fechaMexico(offsetDias: number): string {
  const ahora = new Date(Date.now() + offsetDias * 24 * 60 * 60 * 1000);
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

interface FilaRpc {
  cuenta_id: string;
  empresa_id: string;
  empresa_nombre: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
  saldo_inicial: string | number;
  entradas: string | number;
  salidas: string | number;
  saldo_final: string | number;
  ajuste_saldo: string | number;
  ajuste_nota: string | null;
  tiene_movimientos: boolean;
}

function mapearFila(f: FilaRpc): FilaSaldoCuenta {
  return {
    cuentaId: f.cuenta_id,
    empresaId: f.empresa_id,
    empresaNombre: f.empresa_nombre,
    banco: f.banco,
    ultimos4: f.ultimos_4,
    alias: f.alias,
    saldoInicial: Number(f.saldo_inicial),
    entradas: Number(f.entradas),
    salidas: Number(f.salidas),
    saldoFinal: Number(f.saldo_final),
    ajusteSaldo: Number(f.ajuste_saldo),
    ajusteNota: f.ajuste_nota,
    tieneMovimientos: f.tiene_movimientos,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    const perfil = await obtenerPerfilAutenticado(req);
    if (!perfil) return jsonError("No autenticado", 401);
    if (!veTodasLasEmpresas(perfil)) {
      return jsonError("Este reporte consolida las 8 empresas de Grupo Loma; no está disponible para tu rol.", 403);
    }

    const db = clienteComoUsuario(req);
    const fechaHoy = fechaMexico(0);
    const fechaAyer = fechaMexico(-1);

    // fn_cuentas_estado_cuenta_al: hasta qué día llega el estado de cuenta
    // de cada cuenta aunque no traiga movimientos nuevos (20-nov-2026,
    // Delia). Si falla, el PDF sale sin esa columna llena, no se detiene.
    const [rpcHoy, rpcAyer, rpcAl] = await Promise.all([
      db.rpc("fn_saldos_diario_cuenta", { p_fecha: fechaHoy }),
      db.rpc("fn_saldos_diario_cuenta", { p_fecha: fechaAyer }),
      db.rpc("fn_cuentas_estado_cuenta_al", { p_fecha: fechaHoy }),
    ]);
    if (rpcHoy.error) return jsonError(rpcHoy.error.message, 500);
    if (rpcAyer.error) return jsonError(rpcAyer.error.message, 500);
    const alDia = new Map<string, { al: string | null; ultimo: string | null }>();
    for (const r of (rpcAl.data ?? []) as { cuenta_id: string; ultimo_movimiento: string | null; estado_cuenta_al: string | null }[]) {
      alDia.set(r.cuenta_id, { al: r.estado_cuenta_al, ultimo: r.ultimo_movimiento });
    }

    const filasHoy = ((rpcHoy.data ?? []) as FilaRpc[]).map((f) => {
      const fila = mapearFila(f);
      const a = alDia.get(f.cuenta_id);
      return rpcAl.error ? fila : { ...fila, estadoCuentaAl: a?.al ?? null, ultimoMovimiento: a?.ultimo ?? null };
    });
    const filasAyer = ((rpcAyer.data ?? []) as FilaRpc[]).map(mapearFila);

    const reporteHoy = construirReporteSaldosDia(filasHoy);
    const reporteAyer = construirReporteSaldosDia(filasAyer);

    const pdfBytes = await generarPdfSaldosDiarios({
      generadoPor: perfil.nombre ?? "Usuario Acumulado",
      fechaHoy,
      fechaAyer,
      global: reporteHoy, // la sección global solo lee saldoFinal, que ya es "el saldo más reciente conocido" por construcción del RPC.
      ayer: reporteAyer,
      hoy: reporteHoy,
    });

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="grupo-loma-saldos-${fechaHoy}.pdf"`,
      },
    });
  } catch (err) {
    return jsonError((err as Error).message ?? "Error inesperado", 500);
  }
});
