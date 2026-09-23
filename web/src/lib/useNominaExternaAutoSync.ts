import { useEffect, useRef } from "react";
import { sincronizarNominaExterna } from "./nominaExterna";
import type { NominaExternaOrigen } from "../types/database";

/**
 * Refresca solo las APIs de Grupo Loma cuando la información ya está
 * vieja, al abrir la página.
 *
 * La sincronización de verdad la hace pg_cron cada hora (ver
 * disparar_sincronizacion_nomina_externa) sin que nadie abra nada. Esto es
 * el respaldo: si el cron no se ha activado en el proyecto, o se atrasó,
 * RH no se queda mirando números viejos sin enterarse -- y sigue sin
 * tener que presionar nada.
 *
 * Se intenta una sola vez por montaje: si la API está caída, el error ya
 * queda registrado en ultimo_estado/ultimo_error y la página lo muestra;
 * reintentar en bucle solo taparía el problema.
 */
export function useNominaExternaAutoSync(origenes: NominaExternaOrigen[] | undefined, onSynced: () => void) {
  const attempted = useRef(false);
  // El callback se guarda en un ref (actualizado en su propio efecto, no
  // durante el render) para que volver a crearlo en cada render del
  // componente no dispare otra sincronización.
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    if (!origenes || origenes.length === 0 || attempted.current) return;

    const ahora = Date.now();
    const vieja = (o: NominaExternaOrigen) =>
      o.activo && (o.ultima_sincronizacion == null || ahora - new Date(o.ultima_sincronizacion).getTime() > o.sincronizar_cada_minutos * 60_000);

    if (!origenes.some(vieja)) return;

    attempted.current = true;
    sincronizarNominaExterna()
      .then(() => onSyncedRef.current())
      .catch(() => {
        // El detalle del fallo queda en ultimo_error de cada origen; la
        // página lo muestra ahí, no hace falta un segundo aviso.
      });
  }, [origenes]);
}
