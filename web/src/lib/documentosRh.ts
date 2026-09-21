// Documentos de RH que se generan desde la app como página imprimible
// (contrato individual de trabajo, carta finiquito y aviso de privacidad).
// Todo es puro: reciben datos y regresan HTML (abrirParaImprimir vive en
// imprimir.ts porque usa window y este módulo se compila también para las
// pruebas de node, sin DOM). Los montos del finiquito son de REFERENCIA (LFT
// arts. 76, 80 y 87): RH los revisa antes de firmar.

export interface PersonaDoc {
  nombre: string;
  puesto: string | null;
  curp: string | null;
  rfc: string | null;
  nss: string | null;
  domicilio_particular: string | null;
  fecha_ingreso: string;
  fecha_baja: string | null;
  motivo_baja: string | null;
  sexo: "M" | "F" | null;
  nacionalidad: string;
  estado_civil: string | null;
  fecha_nacimiento: string | null;
}

export interface ContratacionDoc {
  puesto: string;
  sueldo_semanal: number;
  fecha_inicio: string;
  fecha_fin: string;
  duracion_dias: number;
  tipo_contrato: "confidencialidad" | "laboral_determinado" | "laboral_indeterminado" | "prestacion_servicios";
}

export interface PatronDoc {
  razon_social: string;
  representante_legal_nombre: string;
  representante_legal_puesto: string;
  domicilio_legal: string;
  ciudad_firma: string;
  escritura_constitucion_numero?: string | null;
  escritura_constitucion_fecha?: string | null;
  escritura_constitucion_notario?: string | null;
  escritura_constitucion_notaria_numero?: string | null;
  escritura_poderes_numero?: string | null;
  escritura_poderes_fecha?: string | null;
  escritura_poderes_notario?: string | null;
  correo_privacidad?: string | null;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "____ de ________ de ____";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function moneda(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

function esc(t: string | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function diasEntre(desdeIso: string, hastaIso: string): number {
  const a = new Date(desdeIso.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(hastaIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Días de vacaciones por año de servicio cumplido (LFT art. 76, reforma
 * 2023): 12 el primer año, +2 por año hasta 20 en el quinto, y después +2
 * por cada 5 años. */
export function diasVacacionesPorAnio(anioDeServicio: number): number {
  if (anioDeServicio <= 1) return 12;
  if (anioDeServicio <= 5) return 12 + 2 * (anioDeServicio - 1);
  return 20 + 2 * (Math.floor((anioDeServicio - 6) / 5) + 1);
}

export interface Finiquito {
  salarioDiario: number;
  diasTrabajados: number;
  aniosCumplidos: number;
  /** Proporcional del año laboral en curso (días desde el último aniversario). */
  diasAnioEnCurso: number;
  diasVacacionesAnio: number;
  aguinaldoProporcional: number;
  vacacionesProporcionales: number;
  primaVacacional: number;
  total: number;
}

/** Montos de referencia del finiquito por terminación voluntaria/término
 * de contrato: aguinaldo proporcional (15 días, art. 87), vacaciones
 * proporcionales del año en curso (art. 76) y prima vacacional 25 % (art.
 * 80). No incluye salarios devengados pendientes ni indemnizaciones (art.
 * 48/50): esas las agrega RH a mano. */
export function calcularFiniquito(sueldoSemanal: number, fechaIngreso: string, fechaBaja: string): Finiquito {
  const salarioDiario = Math.round((sueldoSemanal / 7) * 100) / 100;
  const diasTrabajados = Math.max(0, diasEntre(fechaIngreso, fechaBaja));
  const aniosCumplidos = Math.floor(diasTrabajados / 365);
  const diasAnioEnCurso = diasTrabajados - aniosCumplidos * 365;
  const anio = fechaBaja.slice(0, 4);
  const inicioAnio = `${anio}-01-01`;
  const diasDelAnioCalendario = Math.min(diasTrabajados, diasEntre(inicioAnio, fechaBaja) + 1);
  const diasVacacionesAnio = diasVacacionesPorAnio(aniosCumplidos + 1);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const aguinaldoProporcional = r2((15 * diasDelAnioCalendario * salarioDiario) / 365);
  const vacacionesProporcionales = r2((diasVacacionesAnio * diasAnioEnCurso * salarioDiario) / 365);
  const primaVacacional = r2(vacacionesProporcionales * 0.25);
  return {
    salarioDiario,
    diasTrabajados,
    aniosCumplidos,
    diasAnioEnCurso,
    diasVacacionesAnio,
    aguinaldoProporcional,
    vacacionesProporcionales,
    primaVacacional,
    total: r2(aguinaldoProporcional + vacacionesProporcionales + primaVacacional),
  };
}

const ESTILO = `
  @page { size: letter; margin: 2cm; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.5; color: #111; max-width: 18cm; margin: 0 auto; padding: 1cm; }
  h1 { font-size: 15pt; text-align: center; text-transform: uppercase; margin: 0 0 4pt; }
  h2 { font-size: 12pt; text-transform: uppercase; margin: 16pt 0 4pt; }
  p { margin: 0 0 8pt; text-align: justify; }
  .centro { text-align: center; }
  .firmas { display: flex; justify-content: space-between; gap: 24pt; margin-top: 48pt; }
  .firma { flex: 1; text-align: center; border-top: 1px solid #111; padding-top: 6pt; font-size: 11pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  td, th { border: 1px solid #999; padding: 4pt 6pt; font-size: 11pt; }
  th { background: #eee; text-align: left; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .nota { font-size: 10pt; color: #555; }
  .boton { position: fixed; top: 8px; right: 8px; font: 13px system-ui, sans-serif; padding: 6px 12px; }
  @media print { .boton { display: none; } }
`;

function documento(titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>` +
    `<button class="boton" onclick="window.print()">Imprimir / guardar PDF</button>${cuerpo}</body></html>`;
}

function articulo(sexo: "M" | "F" | null): { el: string; trabajador: string; sr: string } {
  return sexo === "F" ? { el: "LA", trabajador: "LA TRABAJADORA", sr: "la C." } : { el: "EL", trabajador: "EL TRABAJADOR", sr: "el C." };
}

function bloqueFirmas(patron: PatronDoc, persona: PersonaDoc, etiquetaPersona: string): string {
  return `<div class="firmas">
    <div class="firma">${esc(patron.razon_social)}<br>${esc(patron.representante_legal_nombre)}<br>${esc(patron.representante_legal_puesto)}</div>
    <div class="firma">${esc(etiquetaPersona)}<br>${esc(persona.nombre)}</div>
  </div>
  <div class="firmas"><div class="firma">Testigo</div><div class="firma">Testigo</div></div>`;
}

export function htmlContrato(persona: PersonaDoc, contratacion: ContratacionDoc, patron: PatronDoc): string {
  const g = articulo(persona.sexo);
  const indeterminado = contratacion.tipo_contrato === "laboral_indeterminado";
  const generales = `<p><b>${esc(persona.nombre)}</b>, ${esc(persona.nacionalidad || "mexicana")}, ` +
    `${persona.fecha_nacimiento ? `nacid${persona.sexo === "F" ? "a" : "o"} el ${fechaLarga(persona.fecha_nacimiento)}, ` : ""}` +
    `${persona.estado_civil ? `${esc(persona.estado_civil)}, ` : ""}` +
    `con domicilio en ${esc(persona.domicilio_particular ?? "________________________")}` +
    `${persona.curp ? `, CURP ${esc(persona.curp)}` : ""}${persona.rfc ? `, RFC ${esc(persona.rfc)}` : ""}${persona.nss ? `, NSS ${esc(persona.nss)}` : ""}.</p>`;
  const escritura = patron.escritura_constitucion_numero
    ? ` según escritura pública número ${esc(patron.escritura_constitucion_numero)}${patron.escritura_constitucion_fecha ? ` de fecha ${fechaLarga(patron.escritura_constitucion_fecha)}` : ""}${patron.escritura_constitucion_notario ? `, otorgada ante la fe del ${esc(patron.escritura_constitucion_notario)}${patron.escritura_constitucion_notaria_numero ? `, titular de la Notaría Pública número ${esc(patron.escritura_constitucion_notaria_numero)}` : ""}` : ""}`
    : "";
  const poderes = patron.escritura_poderes_numero
    ? ` Su representante acredita su personalidad con la escritura pública número ${esc(patron.escritura_poderes_numero)}${patron.escritura_poderes_fecha ? ` de fecha ${fechaLarga(patron.escritura_poderes_fecha)}` : ""}${patron.escritura_poderes_notario ? `, otorgada ante el ${esc(patron.escritura_poderes_notario)}` : ""}.`
    : "";

  if (contratacion.tipo_contrato === "prestacion_servicios") {
    return documento(`Contrato de prestación de servicios - ${persona.nombre}`, `
      <h1>Contrato de prestación de servicios profesionales</h1>
      <p class="centro">Que celebran por una parte <b>${esc(patron.razon_social)}</b>, representada por ${esc(patron.representante_legal_nombre)}, en lo sucesivo "EL CLIENTE", y por la otra <b>${esc(persona.nombre)}</b>, en lo sucesivo "EL PRESTADOR", al tenor de las siguientes declaraciones y cláusulas.</p>
      <h2>Declaraciones</h2>
      <p>I. "EL CLIENTE" declara ser una sociedad legalmente constituida conforme a las leyes mexicanas${escritura}, con domicilio en ${esc(patron.domicilio_legal)}.${poderes}</p>
      <p>II. "EL PRESTADOR" declara ser persona física con capacidad legal para obligarse, que cuenta con los conocimientos y experiencia para prestar los servicios objeto de este contrato y que lo hace de manera independiente, sin subordinación.</p>
      ${generales}
      <h2>Cláusulas</h2>
      <p><b>Primera. Objeto.</b> "EL PRESTADOR" se obliga a prestar a "EL CLIENTE" los servicios de <b>${esc(contratacion.puesto)}</b>, con sus propios medios y bajo su responsabilidad.</p>
      <p><b>Segunda. Vigencia.</b> Del ${fechaLarga(contratacion.fecha_inicio)} al ${fechaLarga(contratacion.fecha_fin)} (${contratacion.duracion_dias} días). Podrá renovarse por acuerdo escrito de las partes.</p>
      <p><b>Tercera. Honorarios.</b> "EL CLIENTE" pagará a "EL PRESTADOR" la cantidad de <b>${moneda(contratacion.sueldo_semanal)}</b> por semana de servicios, contra la entrega del comprobante fiscal correspondiente.</p>
      <p><b>Cuarta. Relación entre las partes.</b> Este contrato es de naturaleza civil. No existe relación laboral entre "EL CLIENTE" y "EL PRESTADOR", quien es el único responsable de sus obligaciones fiscales y de seguridad social.</p>
      <p><b>Quinta. Confidencialidad.</b> "EL PRESTADOR" guardará confidencialidad sobre la información de "EL CLIENTE" a la que tenga acceso, durante la vigencia del contrato y cinco años después.</p>
      <p><b>Sexta. Terminación.</b> Cualquiera de las partes podrá dar por terminado el contrato con aviso escrito de quince días de anticipación, liquidándose los servicios prestados hasta esa fecha.</p>
      <p><b>Séptima. Jurisdicción.</b> Para la interpretación y cumplimiento de este contrato, las partes se someten a los tribunales competentes de ${esc(patron.ciudad_firma)}.</p>
      <p class="centro">Se firma por duplicado en ${esc(patron.ciudad_firma)}, el ${fechaLarga(contratacion.fecha_inicio)}.</p>
      ${bloqueFirmas(patron, persona, '"EL PRESTADOR"')}`);
  }

  if (contratacion.tipo_contrato === "confidencialidad") {
    return documento(`Convenio de confidencialidad - ${persona.nombre}`, `
      <h1>Convenio de confidencialidad</h1>
      <p class="centro">Que celebran <b>${esc(patron.razon_social)}</b>, representada por ${esc(patron.representante_legal_nombre)}, en lo sucesivo "LA EMPRESA", y <b>${esc(persona.nombre)}</b>, en lo sucesivo "${g.trabajador}".</p>
      ${generales}
      <h2>Cláusulas</h2>
      <p><b>Primera.</b> ${g.trabajador} reconoce que con motivo de sus funciones como ${esc(contratacion.puesto)} tendrá acceso a información confidencial de "LA EMPRESA": clientes, proveedores, precios, costos, procesos, planos, análisis de precios unitarios, información financiera y cualquier otra no pública.</p>
      <p><b>Segunda.</b> Se obliga a no divulgar, copiar ni usar dicha información para fines distintos a los de su trabajo, durante la relación y por cinco años después de terminada, y a devolver toda la documentación y accesos al concluir.</p>
      <p><b>Tercera.</b> El incumplimiento dará lugar a la rescisión sin responsabilidad para "LA EMPRESA" (art. 47 fracción IX de la Ley Federal del Trabajo) y a las acciones civiles y penales que procedan.</p>
      <p><b>Cuarta.</b> Vigencia a partir del ${fechaLarga(contratacion.fecha_inicio)}.</p>
      <p class="centro">Se firma en ${esc(patron.ciudad_firma)}, el ${fechaLarga(contratacion.fecha_inicio)}.</p>
      ${bloqueFirmas(patron, persona, `"${g.trabajador}"`)}`);
  }

  return documento(`Contrato individual de trabajo - ${persona.nombre}`, `
    <h1>Contrato individual de trabajo por tiempo ${indeterminado ? "indeterminado" : "determinado"}</h1>
    <p class="centro">Que celebran por una parte <b>${esc(patron.razon_social)}</b>, representada por ${esc(patron.representante_legal_nombre)}, en lo sucesivo "EL PATRÓN", y por la otra <b>${esc(persona.nombre)}</b>, en lo sucesivo "${g.trabajador}", conforme a las siguientes declaraciones y cláusulas.</p>
    <h2>Declaraciones</h2>
    <p>I. "EL PATRÓN" declara ser una sociedad legalmente constituida conforme a las leyes de los Estados Unidos Mexicanos${escritura}, con domicilio en ${esc(patron.domicilio_legal)}.${poderes}</p>
    <p>II. ${g.trabajador} declara ser:</p>
    ${generales}
    <p>III. Ambas partes se reconocen la personalidad con que comparecen y manifiestan su voluntad de celebrar este contrato con fundamento en los artículos 20, 24, 25${indeterminado ? "" : ", 35, 37"} y demás aplicables de la Ley Federal del Trabajo.</p>
    <h2>Cláusulas</h2>
    <p><b>Primera. Servicios.</b> ${g.trabajador} se obliga a prestar sus servicios personales subordinados a "EL PATRÓN" con el puesto de <b>${esc(contratacion.puesto)}</b>, desempeñándolos con esmero y eficiencia en el lugar o lugares que "EL PATRÓN" le indique, dentro y fuera del domicilio de la empresa.</p>
    <p><b>Segunda. Duración.</b> ${indeterminado
      ? `Este contrato se celebra por tiempo indeterminado a partir del ${fechaLarga(contratacion.fecha_inicio)}${persona.fecha_ingreso < contratacion.fecha_inicio ? `, reconociéndose la antigüedad desde el ${fechaLarga(persona.fecha_ingreso)}` : ""}.`
      : `Este contrato se celebra por tiempo determinado del ${fechaLarga(contratacion.fecha_inicio)} al ${fechaLarga(contratacion.fecha_fin)} (${contratacion.duracion_dias} días), en virtud de que así lo exige la naturaleza temporal del trabajo a realizar (art. 37 fracción I LFT). Al vencimiento terminará sin responsabilidad para las partes, salvo que subsista la materia del trabajo${persona.fecha_ingreso < contratacion.fecha_inicio ? `. Se reconoce la antigüedad de ${g.trabajador} desde el ${fechaLarga(persona.fecha_ingreso)}` : ""}.`}</p>
    <p><b>Tercera. Salario.</b> "EL PATRÓN" pagará a ${g.trabajador} un salario de <b>${moneda(contratacion.sueldo_semanal)}</b> semanales (${moneda(Math.round((contratacion.sueldo_semanal / 7) * 100) / 100)} diarios), que incluye el pago del séptimo día, pagadero cada semana en el lugar de trabajo o mediante transferencia a la cuenta que ${g.trabajador} designe, previas las deducciones legales.</p>
    <p><b>Cuarta. Jornada.</b> La jornada será de 48 horas a la semana, distribuidas de lunes a sábado en el horario que fije "EL PATRÓN" conforme a las necesidades del trabajo, con un día de descanso semanal con goce de salario. El tiempo extraordinario solo se laborará con autorización escrita.</p>
    <p><b>Quinta. Días de descanso y vacaciones.</b> ${g.trabajador} disfrutará de los días de descanso obligatorio del artículo 74 de la LFT, y de vacaciones anuales conforme al artículo 76 (doce días laborables al cumplir el primer año, aumentando conforme a la ley), con prima vacacional del 25 %.</p>
    <p><b>Sexta. Aguinaldo.</b> ${g.trabajador} recibirá un aguinaldo anual de quince días de salario, pagadero antes del 20 de diciembre, o la parte proporcional al tiempo trabajado.</p>
    <p><b>Séptima. Seguridad social y capacitación.</b> "EL PATRÓN" inscribirá a ${g.trabajador} en el Instituto Mexicano del Seguro Social y cumplirá con las aportaciones al INFONAVIT y al SAR. ${g.trabajador} recibirá la capacitación y adiestramiento que correspondan y se obliga a observar las medidas de seguridad e higiene y a usar el equipo de protección que se le entregue.</p>
    <p><b>Octava. Obligaciones.</b> ${g.trabajador} se obliga a cumplir el Reglamento Interior de Trabajo, las órdenes de sus superiores relativas al trabajo contratado, a cuidar las herramientas, materiales y vehículos que se le confíen, y a guardar confidencialidad sobre la información de "EL PATRÓN" y sus clientes.</p>
    <p><b>Novena. Terminación.</b> La relación de trabajo terminará por las causas del artículo 53 de la LFT y podrá rescindirse por las del artículo 47 sin responsabilidad para "EL PATRÓN", o por las del artículo 51 sin responsabilidad para ${g.trabajador}.</p>
    <p><b>Décima. Datos personales.</b> ${g.trabajador} autoriza el tratamiento de sus datos personales conforme al Aviso de Privacidad de "EL PATRÓN", que declara haber leído.</p>
    <p><b>Décima primera. Jurisdicción.</b> Para todo lo no previsto se estará a la Ley Federal del Trabajo y las partes se someten a los tribunales laborales competentes en ${esc(patron.ciudad_firma)}.</p>
    <p class="centro">Leído que fue por ambas partes y enteradas de su contenido y alcance legal, lo firman por duplicado en ${esc(patron.ciudad_firma)}, el ${fechaLarga(contratacion.fecha_inicio)}.</p>
    ${bloqueFirmas(patron, persona, `"${g.trabajador}"`)}`);
}

const MOTIVO_TEXTO: Record<string, string> = {
  renuncia: "renuncia voluntaria",
  termino_contrato: "terminación del contrato por vencimiento del plazo",
  despido: "rescisión de la relación de trabajo",
  abandono: "abandono del trabajo",
  otro: "terminación de la relación de trabajo",
};

export function textoMotivoBaja(motivo: string | null): string {
  const clave = (motivo ?? "otro").split(":")[0].trim();
  return MOTIVO_TEXTO[clave] ?? MOTIVO_TEXTO.otro;
}

export function htmlFiniquito(persona: PersonaDoc, contratacion: ContratacionDoc | null, patron: PatronDoc): string {
  const g = articulo(persona.sexo);
  const fechaBaja = persona.fecha_baja ?? new Date().toISOString().slice(0, 10);
  const sueldo = contratacion?.sueldo_semanal ?? 0;
  const f = calcularFiniquito(sueldo, persona.fecha_ingreso, fechaBaja);
  const fila = (concepto: string, detalle: string, importe: number | null) =>
    `<tr><td>${esc(concepto)}</td><td class="nota">${esc(detalle)}</td><td class="num">${importe == null ? "$ ____________" : moneda(importe)}</td></tr>`;
  return documento(`Carta finiquito - ${persona.nombre}`, `
    <h1>Carta finiquito</h1>
    <p class="centro">${esc(patron.ciudad_firma)}, a ${fechaLarga(fechaBaja)}</p>
    <p>${g.sr === "la C." ? "La" : "El"} que suscribe, <b>${esc(persona.nombre)}</b>${persona.curp ? `, CURP ${esc(persona.curp)}` : ""}, declaro que presté mis servicios a <b>${esc(patron.razon_social)}</b> con el puesto de ${esc(contratacion?.puesto ?? persona.puesto ?? "________________")} del ${fechaLarga(persona.fecha_ingreso)} al ${fechaLarga(fechaBaja)}, fecha en que concluyó la relación de trabajo por ${textoMotivoBaja(persona.motivo_baja)}.</p>
    <p>Con esta fecha recibo de "EL PATRÓN", a mi entera satisfacción, el pago de las siguientes cantidades:</p>
    <table>
      <tr><th>Concepto</th><th>Base de cálculo</th><th>Importe</th></tr>
      ${fila("Salarios devengados pendientes de pago", "días de la última semana × salario diario", null)}
      ${fila("Aguinaldo proporcional", `15 días × (días trabajados en ${fechaBaja.slice(0, 4)} / 365) × ${moneda(f.salarioDiario)}`, sueldo ? f.aguinaldoProporcional : null)}
      ${fila("Vacaciones proporcionales", `${f.diasVacacionesAnio} días × (${f.diasAnioEnCurso} / 365) × ${moneda(f.salarioDiario)}`, sueldo ? f.vacacionesProporcionales : null)}
      ${fila("Prima vacacional", "25 % de las vacaciones proporcionales", sueldo ? f.primaVacacional : null)}
      ${fila("Otras percepciones / (deducciones)", "", null)}
      <tr><th colspan="2">Total</th><th class="num">$ ____________</th></tr>
    </table>
    <p class="nota">Salario diario de referencia: ${sueldo ? moneda(f.salarioDiario) : "sin contratación registrada, capturar a mano"} (sueldo semanal ÷ 7). Antigüedad: ${f.aniosCumplidos} año(s) y ${f.diasAnioEnCurso} día(s). Los importes calculados son de referencia conforme a los artículos 76, 80 y 87 de la Ley Federal del Trabajo; verificar antes de firmar. Si la terminación fue por rescisión imputable al patrón, agregar la indemnización de los artículos 48 y 50.</p>
    <p>Con el pago anterior manifiesto que no se me adeuda cantidad alguna por concepto de salarios, tiempo extraordinario, días de descanso, vacaciones, prima vacacional, aguinaldo, prima de antigüedad, ni por ningún otro concepto derivado de la relación de trabajo, por lo que otorgo a <b>${esc(patron.razon_social)}</b>, a sus representantes y a sus empresas filiales, el finiquito más amplio que en derecho proceda, sin reservarme acción ni derecho alguno que ejercitar en su contra.</p>
    <p>Asimismo hago constar que durante la relación de trabajo no sufrí riesgo de trabajo alguno y que he devuelto las herramientas, equipo, credenciales y accesos que me fueron entregados.</p>
    <div class="firmas">
      <div class="firma">${esc(persona.nombre)}<br>${g.trabajador}</div>
      <div class="firma">${esc(patron.razon_social)}<br>${esc(patron.representante_legal_nombre)}</div>
    </div>
    <div class="firmas"><div class="firma">Testigo</div><div class="firma">Testigo</div></div>`);
}

export function htmlAvisoPrivacidad(patron: PatronDoc, persona?: Pick<PersonaDoc, "nombre"> | null): string {
  const correo = patron.correo_privacidad ?? "el área de Recursos Humanos";
  return documento(`Aviso de privacidad - ${patron.razon_social}`, `
    <h1>Aviso de privacidad integral para colaboradores</h1>
    <p><b>${esc(patron.razon_social)}</b>, con domicilio en ${esc(patron.domicilio_legal)}, es responsable del tratamiento de sus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares y su Reglamento.</p>
    <h2>Datos que recabamos</h2>
    <p>Datos de identificación y contacto (nombre, domicilio, teléfono, correo, fecha de nacimiento, estado civil, nacionalidad, CURP, RFC, INE), datos laborales (puesto, salario, fecha de ingreso, asistencia y registros de entrada y salida, asignaciones de obra), datos de seguridad social (NSS, INFONAVIT), datos bancarios para el pago de nómina, datos de contacto de emergencia y beneficiarios, y los documentos que integran su expediente laboral (constancia de situación fiscal, comprobante de domicilio, carta de antecedentes no penales, licencia de conducir cuando aplique). Los datos de salud que lleguen a recabarse con motivo de incapacidades o riesgos de trabajo se consideran datos sensibles y se tratan únicamente para cumplir obligaciones laborales y de seguridad social.</p>
    <h2>Finalidades</h2>
    <p>Primarias: integrar su expediente, formalizar la relación de trabajo, pagar nómina y prestaciones, cumplir obligaciones ante el IMSS, INFONAVIT, SAT y autoridades laborales, controlar asistencia y asignación de personal entre las empresas del grupo, atender emergencias y elaborar los documentos de terminación de la relación laboral. Secundarias: comunicados internos y programas de capacitación. Si no desea que sus datos se usen para las finalidades secundarias, indíquelo a ${esc(correo)}.</p>
    <h2>Transferencias</h2>
    <p>Sus datos pueden compartirse con las demás empresas de Grupo Loma para la administración del personal y el prorrateo de su costo entre obras, con instituciones bancarias para el pago de nómina, con el IMSS, INFONAVIT, SAT y autoridades que lo requieran, y con proveedores que prestan servicios de sistemas y nómina, quienes están obligados a la confidencialidad. No se realizarán otras transferencias sin su consentimiento.</p>
    <h2>Derechos ARCO</h2>
    <p>Usted puede acceder, rectificar o cancelar sus datos personales, u oponerse a su tratamiento, así como revocar su consentimiento, presentando una solicitud a ${esc(correo)} con su nombre, un medio para responderle, copia de una identificación oficial y la descripción clara de los datos y del derecho que desea ejercer. Le responderemos en un plazo máximo de veinte días hábiles.</p>
    <h2>Conservación y seguridad</h2>
    <p>Sus datos se conservan durante la relación laboral y por el plazo que exigen las leyes laborales y fiscales después de su terminación. Aplicamos medidas administrativas, técnicas y físicas para protegerlos, incluido el acceso restringido por rol dentro de nuestros sistemas.</p>
    <h2>Cambios al aviso</h2>
    <p>Cualquier modificación se publicará en la aplicación interna del grupo y en el área de Recursos Humanos.</p>
    ${persona ? `<p style="margin-top:32pt">He leído y acepto el presente aviso de privacidad.</p><div class="firmas"><div class="firma">${esc(persona.nombre)}<br>Fecha: ____ / ____ / ______</div><div class="firma">${esc(patron.razon_social)}<br>Recursos Humanos</div></div>` : ""}`);
}
