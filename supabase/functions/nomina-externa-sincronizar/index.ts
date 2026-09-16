// Trae la nómina fija (semanal/quincenal) y la mano de obra desde las APIs
// de Grupo Loma y deja el espejo en la base, para que la página de RH las
// lea con RLS normal.
//
// Va del lado del servidor y no del navegador por tres razones: la API de
// Grupo Loma no tiene por qué permitir CORS desde Vercel, un token (si algún
// día lo pide) no puede vivir en el frontend, y el reemplazo del lote debe
// ser atómico (lo hace el RPC reemplazar_renglones_nomina_externa).
//
// POST body: { origen?: "mano_obra" | "nomina_semanal" | "nomina_quincenal" }
//   sin `origen` sincroniza todos los orígenes activos.
//
// También la llama pg_cron sin sesión de usuario: en ese caso llega con la
// cabecera x-cron-secret, comparada contra config_sistema.cron_secret --
// mismo patrón que push-enviar-recordatorios (no hay forma de fijar
// secrets de edge function desde este entorno, así que el secreto vive en
// la base, no en una variable de entorno).

import { clienteServicio, obtenerPerfilAutenticado } from "../_shared/supabase-clients.ts";
import { jsonResponse, respuestaCors } from "../_shared/cors.ts";
import { normalizeBatch, type FieldGuess } from "../_shared/nomina-externa.ts";

// La quincenal tarda más en responder que un fetch por default; 60 s da margen de sobra.
const FETCH_TIMEOUT_MS = 60_000;

async function esLlamadaDeCronAutorizada(req: Request): Promise<boolean> {
  const recibido = req.headers.get("x-cron-secret");
  if (!recibido) return false;
  const dbServicio = clienteServicio();
  const { data } = await dbServicio.from("config_sistema").select("valor").eq("clave", "cron_secret").maybeSingle();
  const esperado = data?.valor;
  if (!esperado || recibido.length !== esperado.length) return false;
  // Comparación en tiempo constante para no filtrar el secreto por cuánto
  // tarda la comparación.
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return diff === 0;
}

interface FilaOrigen {
  origen: string;
  nombre: string;
  url: string;
  activo: boolean;
}

interface FilaMapeo {
  origen: string;
  campo_id: string | null;
  campo_empleado: string | null;
  campo_importe: string | null;
  campo_periodo: string | null;
  campo_centro_costos: string | null;
}

async function consultarOrigen(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const respuesta = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const cuerpo = await respuesta.text();
    if (!respuesta.ok) {
      throw new Error(`La API respondió ${respuesta.status} ${respuesta.statusText}: ${cuerpo.slice(0, 300)}`);
    }
    try {
      return JSON.parse(cuerpo);
    } catch {
      // Pasa cuando el endpoint contesta HTML (una pantalla de login, por
      // ejemplo) en vez de JSON: hay que decirlo tal cual, no fingir cero
      // registros.
      throw new Error(`La API no devolvió JSON (empieza con: ${cuerpo.slice(0, 120).trim()})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// deno-lint-ignore no-explicit-any
async function sincronizarUno(db: any, origen: FilaOrigen, mapeo: FilaMapeo | undefined) {
  try {
    const payload = await consultarOrigen(origen.url);
    // Un mapeo ya guardado (o sembrado) manda sobre la heurística. Ojo con
    // campo_id: en mano de obra vale null a propósito (no hay columna de
    // id único), y ese null NO debe convertirse en undefined -- si no, la
    // heurística volvería a proponer Id_mo_cat, que se repite entre
    // renglones.
    const overrides: Partial<FieldGuess> = mapeo
      ? {
          idField: mapeo.campo_id,
          employeeField: mapeo.campo_empleado,
          amountField: mapeo.campo_importe,
          periodField: mapeo.campo_periodo,
          costCenterField: mapeo.campo_centro_costos,
        }
      : {};
    const lote = normalizeBatch(payload, overrides);

    const { data, error } = await db.rpc("reemplazar_renglones_nomina_externa", {
      p_origen: origen.origen,
      p_renglones: lote.records,
      p_columnas: lote.columns,
      p_propuesta: lote.guess,
      p_total_centavos: lote.totalCents,
    });
    if (error) throw new Error(error.message);

    return { origen: origen.origen, ok: true, renglones: data ?? lote.records.length, totalCentavos: lote.totalCents };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await db.rpc("marcar_error_sincronizacion_nomina_externa", { p_origen: origen.origen, p_error: mensaje });
    return { origen: origen.origen, ok: false, error: mensaje };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return respuestaCors();

  try {
    if (!(await esLlamadaDeCronAutorizada(req))) {
      const perfil = await obtenerPerfilAutenticado(req);
      if (!perfil) return jsonResponse({ error: "No autenticado" }, 401);
      if (perfil.rol !== "admin" && perfil.rol !== "rh") {
        return jsonResponse({ error: "Solo un admin o Recursos Humanos pueden sincronizar la nómina externa" }, 403);
      }
    }

    let origenPedido: string | undefined;
    try {
      origenPedido = (await req.json())?.origen;
    } catch {
      // Sin body: se sincronizan todos los orígenes activos.
    }

    const dbServicio = clienteServicio();
    const consultaOrigenes = dbServicio.from("nomina_externa_origenes").select("origen, nombre, url, activo").eq("activo", true);
    const { data: origenes, error: errOrigenes } = origenPedido ? await consultaOrigenes.eq("origen", origenPedido) : await consultaOrigenes;
    if (errOrigenes) return jsonResponse({ error: errOrigenes.message }, 500);
    if (!origenes || origenes.length === 0) {
      return jsonResponse({ error: origenPedido ? `Origen desconocido o inactivo: ${origenPedido}` : "No hay orígenes activos" }, 400);
    }

    const { data: mapeos } = await dbServicio.from("nomina_externa_mapeos").select("*");
    const mapeoPorOrigen = new Map<string, FilaMapeo>(((mapeos ?? []) as FilaMapeo[]).map((m) => [m.origen, m]));

    const resultados = [];
    for (const origen of origenes as FilaOrigen[]) {
      resultados.push(await sincronizarUno(dbServicio, origen, mapeoPorOrigen.get(origen.origen)));
    }

    // 207: al menos un origen falló pero otros sí entraron -- la página
    // muestra el detalle por origen en vez de un "todo bien" engañoso.
    const algunoFallo = resultados.some((r) => !r.ok);
    return jsonResponse({ resultados }, algunoFallo ? 207 : 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
