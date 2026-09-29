import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

function diasRestantes(hasta: string | null): number | null {
  if (!hasta) return null;
  return Math.ceil((new Date(hasta).getTime() - Date.now()) / 86_400_000);
}

// Aviso del estado de la suscripción. Aparece solo cuando hay algo que decir:
// una organización al corriente no ve nada. Cuando ya está en solo lectura la
// idea es que nadie descubra el bloqueo al intentar guardar -- se dice antes,
// y se dice qué hacer.
export function AvisoSuscripcion() {
  const { suscripcion, suscripcionPermiteEscribir, soloConsulta, perfil, perfilReal, esAdminGlobal } = useAuth();
  if (esAdminGlobal) return null;

  const esAdmin = perfil?.rol === "admin";

  // Espectador, o una organización que todavía no contrata: se dice desde el
  // principio que es solo para consultar, antes de que alguien intente guardar.
  if (soloConsulta && (perfilReal?.espectador || !suscripcion)) {
    return (
      <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <span>
            {perfilReal?.espectador
              ? "Tu cuenta es de solo consulta: puedes ver y exportar la información, pero no capturar, editar ni borrar."
              : "Tu organización todavía no tiene la suscripción activa: puedes consultar, pero no capturar ni cargar nada."}
          </span>
          {esAdmin && !suscripcion && (
            <Link to="/admin/suscripcion" className="shrink-0 rounded bg-sky-700 px-3 py-1 font-medium text-white">
              Activar suscripción
            </Link>
          )}
        </div>
      </div>
    );
  }
  if (!suscripcion) return null;
  const dias = diasRestantes(suscripcion.escribe_hasta);

  if (!suscripcionPermiteEscribir) {
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <span>
            La suscripción no está al corriente: puedes consultar y exportar tu información, pero no capturar ni cargar nada.
          </span>
          {esAdmin && (
            <Link to="/admin/suscripcion" className="shrink-0 rounded bg-red-700 px-3 py-1 font-medium text-white">
              Activar suscripción
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Solo se avisa cuando el plazo ya está cerca; un "te quedan 25 días" cada
  // día es ruido y deja de leerse justo cuando importa.
  const enRiesgo = suscripcion.estado === "periodo_gracia" || (dias !== null && dias <= 7);
  if (!enRiesgo) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <span>
          {suscripcion.estado === "periodo_gracia"
            ? "El último cobro no se pudo realizar."
            : suscripcion.estado === "prueba"
              ? "Tu periodo de prueba está por terminar."
              : "Tu suscripción está por vencer."}{" "}
          {dias !== null && dias >= 0 && (
            <>
              Quedan <strong>{dias === 0 ? "menos de un día" : `${dias} día${dias === 1 ? "" : "s"}`}</strong> antes de pasar a
              solo lectura.
            </>
          )}
        </span>
        {esAdmin && (
          <Link to="/admin/suscripcion" className="shrink-0 rounded bg-amber-700 px-3 py-1 font-medium text-white">
            Revisar suscripción
          </Link>
        )}
      </div>
    </div>
  );
}
