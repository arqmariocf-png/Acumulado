// Cálculo del precio de una suscripción. Puro y aparte de la pasarela: el
// mismo criterio tiene que dar el mismo número en la base
// (precio_unitario_centavos en 20260923090007), en la pantalla de cuenta y en
// lo que se le manda a la pasarela. Si los tres no coinciden, alguien cobra o
// paga de más.

export interface Escalon {
  desdeUsuarios: number;
  precioUnitarioCentavos: number;
}

export interface Cobro {
  usuarios: number;
  precioUnitarioCentavos: number;
  totalCentavos: number;
  /** Desde cuántos usuarios aplica el escalón vigente. */
  escalonDesde: number;
  /** Cuántos usuarios faltan para el siguiente escalón, y a qué precio. null si ya está en el último. */
  siguienteEscalon: { faltanUsuarios: number; precioUnitarioCentavos: number } | null;
}

/** El escalón aplica a TODOS los usuarios, no solo a los adicionales: con 5
 * usuarios, los cinco pagan el precio del escalón de 5. Es la decisión de
 * negocio (un "paquete", no una tarifa marginal como los impuestos) y está
 * aquí y no repartida por la interfaz para que no se interprete distinto en
 * cada pantalla. */
export function calcularCobro(escalones: Escalon[], usuarios: number): Cobro {
  if (escalones.length === 0) throw new Error("El plan no tiene escalones de precio configurados");

  const ordenados = [...escalones].sort((a, b) => a.desdeUsuarios - b.desdeUsuarios);
  // Cero usuarios se cotiza como uno: el precio de lista que se le enseña a
  // alguien que todavía no da de alta a nadie es el del primer escalón, no $0.
  const efectivos = Math.max(usuarios, 0);
  const paraEscalon = Math.max(efectivos, 1);

  const vigente = ordenados.filter((e) => e.desdeUsuarios <= paraEscalon).pop() ?? ordenados[0];
  const siguiente = ordenados.find((e) => e.desdeUsuarios > paraEscalon) ?? null;

  return {
    usuarios: efectivos,
    precioUnitarioCentavos: vigente.precioUnitarioCentavos,
    totalCentavos: efectivos * vigente.precioUnitarioCentavos,
    escalonDesde: vigente.desdeUsuarios,
    siguienteEscalon: siguiente
      ? {
          faltanUsuarios: siguiente.desdeUsuarios - efectivos,
          precioUnitarioCentavos: siguiente.precioUnitarioCentavos,
        }
      : null,
  };
}

/** Lo que costaría agregar un usuario más. No es el precio unitario cuando el
 * usuario nuevo cruza un escalón: ahí la mensualidad puede incluso BAJAR
 * (pasar de 4×$1,500 = $6,000 a 5×$1,300 = $6,500 sube $500, no $1,300). Es el
 * número que hay que enseñar antes de dar de alta a alguien. */
export function costoDeAgregarUsuario(escalones: Escalon[], usuariosActuales: number): number {
  const antes = calcularCobro(escalones, usuariosActuales).totalCentavos;
  const despues = calcularCobro(escalones, usuariosActuales + 1).totalCentavos;
  return despues - antes;
}
