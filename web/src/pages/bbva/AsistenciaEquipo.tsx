import { MarcasChecador } from "../rh/MarcasChecador";

/** Asistencia del equipo de mantenimiento BBVA para el encargado (Christian):
 * ve las marcas del checador de las personas que RH marcó en el área
 * bbva_puebla y de quienes RH le asignó como supervisor (Accesos, columna
 * Supervisor). Solo lectura -- quién es del equipo lo decide RH. */
export function AsistenciaEquipo() {
  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Asistencia del equipo</h1>
      <p className="mb-4 text-sm text-slate-500">
        Marcas de entrada, comida y salida de las personas del área de mantenimiento BBVA, con foto y ubicación. El equipo lo arma RH en
        Recursos Humanos: columna Área en Personal, o columna Supervisor en Accesos al sistema.
      </p>
      <MarcasChecador titulo="Marcas del equipo" />
    </div>
  );
}
