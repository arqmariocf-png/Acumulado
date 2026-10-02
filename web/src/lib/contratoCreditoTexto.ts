// Texto fijo del "Contrato mercantil de suministro con línea de crédito
// comercial" propuesto por los abogados (Mario, 1-oct-2026; archivo
// Contrato_RAMSICON_llenado.docx). NO editar a mano sin el visto bueno de los
// abogados: lo variable va entre {{…}} y lo llena contratoCredito.ts.
// {{MONTO}} línea de crédito · {{INTERES}} moratorio · {{OBLIGADO}} obligado
// solidario · {{NOTIFICACIONES}} domicilios y contactos · {{FIRMA}} lugar y fecha.

export interface ClausulaContrato {
  titulo: string;
  parrafos: string[];
}

export const CLAUSULAS_CONTRATO_CREDITO: ClausulaContrato[] = [
  {
    "titulo": "PRIMERA. OBJETO.",
    "parrafos": [
      "El objeto del presente contrato consiste en establecer los términos y condiciones conforme a los cuales “EL PROVEEDOR” venderá y suministrará a “EL COMPRADOR”, de manera periódica y sucesiva, los productos, mercancías o bienes que éste solicite y que sean expresamente aceptados por “EL PROVEEDOR”.",
      "Cada operación particular podrá documentarse mediante órdenes de compra, cotizaciones, confirmaciones de pedido, facturas, así como las solicitudes, aceptación, entrega y recepción de las mercancías.",
      "La celebración del presente contrato no obliga a “EL PROVEEDOR” a mantener un inventario determinado ni implica la obligación de aceptar la totalidad de los pedidos que formule “EL COMPRADOR”, quedando cada suministro sujeto a disponibilidad, condiciones comerciales vigentes y, en su caso, al límite disponible de la línea de crédito."
    ]
  },
  {
    "titulo": "SEGUNDA. ÓRDENES DE COMPRA Y ACEPTACIÓN DE PEDIDOS.",
    "parrafos": [
      "“EL COMPRADOR” realizará sus solicitudes de mercancía mediante órdenes de compra emitidas por personas autorizadas por “EL PROVEEDOR” para tal efecto.",
      "Las órdenes de compra deberán contener, cuando menos, descripción del producto, cantidad, precio o referencia comercial, lugar de entrega y cualquier condición especial que resulte aplicable.",
      "Una orden de compra no se considerará automáticamente aceptada por “EL PROVEEDOR” por el solo hecho de haber sido recibida.",
      "La aceptación podrá constar mediante confirmación por correo electrónico, así como la emisión de la factura y posteriormente la entrega de mercancía.",
      "Una vez aceptada la orden de compra, ésta será obligatoria para ambas partes en los términos confirmados."
    ]
  },
  {
    "titulo": "TERCERA. PRECIOS, IMPUESTOS Y CONDICIONES COMERCIALES.",
    "parrafos": [
      "El precio aplicable a cada operación será el que se encuentre vigente al momento en que “EL PROVEEDOR” acepte el pedido, salvo que “LAS PARTES” hayan acordado expresamente un precio distinto por escrito.",
      "Los precios no comprenderán aquellos impuestos, derechos, contribuciones, gastos de transporte, maniobras, seguros u otros conceptos que, conforme a la naturaleza de la operación, deban trasladarse adicionalmente a “EL COMPRADOR”, salvo pacto expreso en contrario.",
      "El Impuesto al Valor Agregado (I.V.A) y demás contribuciones que legalmente correspondan serán cubiertos por “EL COMPRADOR” en los términos establecidos en la legislación fiscal aplicable."
    ]
  },
  {
    "titulo": "CUARTA. LÍNEA DE CRÉDITO COMERCIAL.",
    "parrafos": [
      "“EL PROVEEDOR” concede a “EL COMPRADOR” una línea de crédito comercial de carácter revolvente, hasta por la cantidad máxima de: {{MONTO}}.",
      "La línea de crédito tendrá como finalidad exclusiva financiar comercialmente la adquisición de mercancías suministradas por “EL PROVEEDOR”, por lo que en ningún caso podrá considerarse como préstamo de dinero, mutuo o una apertura de crédito bancaria.",
      "El límite, plazo, condiciones de pago y demás parámetros podrán constar igualmente en la Solicitud de Crédito Comercial que se agrega como Anexo “A”, formando parte integrante del presente contrato.",
      "El saldo disponible de la línea se determinará considerando los adeudos exigibles, facturas pendientes de pago, pedidos aceptados y cualquier otro concepto que razonablemente deba computarse conforme a las condiciones comerciales autorizadas."
    ]
  },
  {
    "titulo": "QUINTA. FACULTAD DE SUSPENDER EL CRÉDITO.",
    "parrafos": [
      "“EL PROVEEDOR” podrá suspender temporal o definitivamente la línea de crédito cuando:",
      "a. Cuando “EL COMPRADOR” incurra en mora respecto del pago de una o más facturas, documentos, obligaciones o cantidades derivadas de las operaciones celebradas con “EL PROVEEDOR”.",
      "b. Cuando “EL COMPRADOR” exceda, pretenda exceder o se encuentre próximo a exceder el límite máximo de crédito autorizado.",
      "c. Cuando existan facturas vencidas, saldos insolutos o cualquier cantidad pendiente de pago, aun cuando se encuentre dentro del límite nominal de la línea de crédito.",
      "d. Cuando algún cheque, transferencia, depósito, pagaré o cualquier otro instrumento de pago entregado por “EL COMPRADOR” sea rechazado, devuelto, cancelado o no pueda hacerse efectivo por cualquier causa imputable a éste.",
      "e. Cuando “EL COMPRADOR” solicite prórrogas, convenios, reestructuraciones o facilidades adicionales para el pago de sus obligaciones, o manifieste dificultades para cubrir oportunamente sus adeudos.",
      "f. Cuando “EL PROVEEDOR” tenga conocimiento de circunstancias objetivas que razonablemente hagan presumir un deterioro en la capacidad económica, financiera o patrimonial de “EL COMPRADOR” que pueda poner en riesgo el cumplimiento de sus obligaciones.",
      "g. Cuando “EL COMPRADOR” proporcione información falsa, incompleta, inexacta o desactualizada con motivo de la solicitud, autorización, mantenimiento o renovación de la línea de crédito.",
      "h. Cuando “EL COMPRADOR” omita informar cualquier circunstancia relevante que afecte sustancialmente su capacidad para cumplir con las obligaciones asumidas.",
      "i. Cuando se inicie en contra de “EL COMPRADOR” cualquier procedimiento judicial, mercantil, penal, civil, administrativo, concursal o de ejecución que, a consideración razonable de “EL PROVEEDOR”, pueda afectar de manera significativa su solvencia o capacidad de pago.",
      "j. Cuando se practique embargo, aseguramiento, intervención, ejecución o cualquier otra medida sobre bienes de “EL COMPRADOR” que razonablemente pueda comprometer el cumplimiento de sus obligaciones.",
      "k. Cuando “EL COMPRADOR” incumpla cualquiera de las obligaciones establecidas en el presente contrato, en la Solicitud de Crédito Comercial, en las órdenes de compra aceptadas o en cualquier documento relacionado con la línea de crédito.",
      "l. Cuando exista incumplimiento respecto de cualquier garantía otorgada a favor de “EL PROVEEDOR”, incluyendo, de manera enunciativa más no limitativa, pagarés, avales, obligaciones solidarias, fianzas o garantías reales.",
      "m. Cuando se produzca cualquier modificación relevante en las circunstancias personales, patrimoniales o económicas de “EL COMPRADOR” que, de manera razonable, pueda representar un incremento en el riesgo de recuperación del crédito.",
      "n. Cuando “EL COMPRADOR” destine la facilidad comercial otorgada a una finalidad distinta de la adquisición de los productos objeto de las operaciones celebradas con “EL PROVEEDOR”.",
      "o. Cuando “EL PROVEEDOR” determine, con base en sus políticas internas de crédito y riesgo comercial, que resulta necesario reducir o cancelar la exposición crediticia de “EL COMPRADOR”.",
      "En cualquiera de los supuestos anteriores, “EL PROVEEDOR” podrá suspender de manera inmediata la autorización de nuevos pedidos a crédito, reducir el límite disponible, exigir el pago de contado respecto de operaciones posteriores o solicitar garantías adicionales como condición para continuar otorgando crédito.",
      "La suspensión, reducción o cancelación de la línea de crédito no extinguirá, modificará ni suspenderá las obligaciones de pago previamente contraídas por “EL COMPRADOR”, las cuales continuarán siendo exigibles en los términos originalmente pactados.",
      "En caso de suspensión o cancelación de la línea de crédito, “EL PROVEEDOR” podrá determinar que las operaciones posteriores únicamente se realicen mediante pago anticipado o de contado, sin que dicha determinación pueda considerarse negativa, incumplimiento, rescisión o modificación unilateral de las obligaciones previamente adquiridas por “EL PROVEEDOR”.",
      "En estos supuestos, “EL PROVEEDOR” podrá exigir el pago del saldo insoluto, intereses, gastos y demás accesorios legalmente procedentes."
    ]
  },
  {
    "titulo": "SEXTA. FACTURACIÓN Y VENCIMIENTO.",
    "parrafos": [
      "“EL PROVEEDOR” emitirá los comprobantes fiscales correspondientes a las operaciones realizadas.",
      "Cada factura indicará, según corresponda, el importe de la mercancía, impuestos, descuentos, fecha de emisión, fecha de vencimiento y demás información fiscal y comercial correspondiente.",
      "“EL COMPRADOR” deberá pagar cada factura dentro del plazo expresamente autorizado en el Anexo “A” o en la documentación comercial correspondiente.",
      "La falta de objeción a una factura dentro de un plazo de 3 (tres) días hábiles contados a partir de su recepción se entenderá como aceptación de sus datos comerciales, sin perjuicio de los derechos que legalmente correspondan respecto de errores fiscales, defectos no aparentes o conceptos que objetivamente no hubieran podido ser conocidos con anterioridad."
    ]
  },
  {
    "titulo": "SÉPTIMA. FORMA DE PAGO.",
    "parrafos": [
      "Todos los pagos deberán realizarse mediante transferencia electrónica, depósito bancario previamente autorizado por “EL PROVEEDOR”.",
      "Los pagos efectuados por “EL COMPRADOR” se acreditarán mediante la ficha de depósito bancario, comprobante de transferencia electrónica o documento bancario equivalente, debiendo remitirse a “EL PROVEEDOR” para su identificación y cotejo.",
      "El pago se tendrá por realizado únicamente cuando los recursos se encuentren efectivamente disponibles y acreditados en la cuenta designada por “EL PROVEEDOR”.",
      "“EL COMPRADOR” no podrá suspender, retener, compensar o disminuir unilateralmente los pagos adeudados alegando créditos, reclamaciones o contraprestaciones distintas, salvo autorización expresa y por escrito de “EL PROVEEDOR” o determinación de autoridad competente."
    ]
  },
  {
    "titulo": "OCTAVA. MORA E INTERESES MORATORIOS.",
    "parrafos": [
      "El incumplimiento en el pago de cualquier cantidad a su vencimiento producirá la mora de “EL COMPRADOR” sin necesidad de requerimiento judicial o extrajudicial previo.",
      "A partir del día siguiente al vencimiento de la obligación, el saldo insoluto devengará un interés moratorio equivalente al {{INTERES}} mensual, calculado únicamente sobre las cantidades efectivamente vencidas y pendientes de pago, hasta la fecha de su total liquidación.",
      "Para efectos de cálculo, el interés se determinará proporcionalmente por los días efectivamente transcurridos.",
      "En ningún caso el pago de intereses moratorios implicará novación de la obligación principal."
    ]
  },
  {
    "titulo": "NOVENA. PROPIEDAD INDUSTRIAL Y PROHIBICIÓN DE REPRODUCCIÓN Y REVENTA.",
    "parrafos": [
      "“EL COMPRADOR” reconoce que los productos, diseños, modelos, piezas, prototipos, especificaciones, catálogos, imágenes, marcas, nombres comerciales, elementos distintivos y demás materiales que le sean proporcionados por “EL PROVEEDOR” pueden encontrarse protegidos por derechos de propiedad industrial y/o intelectual, por lo que se obliga a no reproducir, copiar, modificar, fabricar, mandar fabricar, imitar, registrar, comercializar o utilizar para fines distintos a los expresamente autorizados cualquiera de dichos elementos.",
      "Asimismo, “EL COMPRADOR” se obliga a no utilizar la información, diseños o especificaciones proporcionadas por “EL PROVEEDOR” para desarrollar o solicitar a terceros la fabricación de productos iguales o sustancialmente similares a los adquiridos.",
      "“EL COMPRADOR” tampoco podrá revender, distribuir, transferir o comercializar los productos adquiridos a terceros cuando ello implique vulnerar derechos de propiedad industrial de “EL PROVEEDOR” o contravenir las condiciones comerciales bajo las cuales fueron suministrados, salvo autorización previa y por escrito de “EL PROVEEDOR”.",
      "El incumplimiento de la presente cláusula facultará a “EL PROVEEDOR” para suspender o cancelar inmediatamente la línea de crédito y/o la relación comercial, sin perjuicio de ejercer las acciones legales correspondientes y reclamar los daños, perjuicios, gastos y demás consecuencias que legalmente procedan."
    ]
  },
  {
    "titulo": "DÉCIMA. GARANTÍAS DE PAGO.",
    "parrafos": [
      "Con el objeto de garantizar el cumplimiento de las obligaciones derivadas del presente contrato, “EL COMPRADOR” proporcionará las garantías que se especifican en la Solicitud de Crédito Comercial (Anexo “A”) y en los documentos que, en su caso, se suscriban con motivo de la autorización de la línea.",
      "Las garantías podrán comprender, entre otras, pagaré, aval, obligación solidaria, fianza, garantía real o cualquier otra que sea jurídicamente válida y expresamente aceptada por “EL PROVEEDOR”.",
      "La existencia de una garantía no limitará ni sustituirá la obligación principal de pago."
    ]
  },
  {
    "titulo": "DÉCIMA PRIMERA. PAGARÉ.",
    "parrafos": [
      "Como garantía adicional de las obligaciones de pago, se suscribirá uno o varios pagarés a favor de “EL PROVEEDOR”, de acuerdo al monto solicitado en la línea de crédito por la cantidad y bajo las condiciones que correspondan a la misma línea de crédito autorizada.",
      "Los pagarés deberán cumplir con los requisitos establecidos por la Ley General de Títulos y Operaciones de Crédito.",
      "La entrega de los pagarés tendrá carácter de garantía y no implicará novación de las obligaciones causales derivadas del presente contrato.",
      "En caso de incumplimiento, “EL PROVEEDOR” podrá ejercer los derechos y acciones derivados tanto de la relación causal como de los títulos de créditos, en los términos permitidos por la legislación aplicable."
    ]
  },
  {
    "titulo": "DÉCIMA SEGUNDA. AVAL Y OBLIGACIÓN SOLIDARIA.",
    "parrafos": [
      "Cuando así se determine en la Solicitud de Crédito Comercial, la persona física que suscriba los documentos correspondientes podrá constituirse como avalista de los pagarés y/o como obligado solidario respecto de las obligaciones de “EL COMPRADOR”.",
      "{{OBLIGADO}}",
      "La calidad de aval deberá constar en el propio título de crédito con la firma correspondiente.",
      "La obligación solidaria deberá constar expresamente en el presente documento mediante el cual la persona física manifieste su voluntad de obligarse personalmente.",
      "La responsabilidad del avalista y/o obligado solidario se determinará conforme al alcance específico del documento que suscriba."
    ]
  },
  {
    "titulo": "DÉCIMA TERCERA. ENTREGA Y TRANSMISIÓN DE RIESGOS.",
    "parrafos": [
      "La entrega de las mercancías se realizará en el domicilio expresamente señalado en la orden de compra o documentación correspondiente.",
      "Salvo pacto distinto, el riesgo de pérdida, daño o deterioro de las mercancías se transmitirá a “EL COMPRADOR” al momento de su entrega material y recepción por éste, por personal autorizado o por el transportista que corresponda, según las condiciones específicas de cada operación.",
      "La firma del documento de entrega, acuse electrónico o constancia equivalente constituirá evidencia de la recepción de la mercancía."
    ]
  },
  {
    "titulo": "DÉCIMA CUARTA. REVISIÓN DE MERCANCÍAS, FALTANTES Y DAÑOS APARENTES.",
    "parrafos": [
      "“EL COMPRADOR” deberá revisar las mercancías al momento de su recepción o, cuando ello materialmente no sea posible, dentro de un plazo máximo de 3 (tres) días hábiles.",
      "Los daños visibles, faltantes, diferencias de cantidad o defectos manifiestos deberán notificarse por escrito a “EL PROVEEDOR” dentro de dicho plazo, acompañando evidencia suficiente, incluyendo, cuando resulte procedente, fotografías, videos, remisiones y demás documentación disponible.",
      "Si “EL COMPRADOR” recibe las mercancías sin formular observación alguna respecto de defectos o daños que razonablemente podían ser detectados mediante una revisión ordinaria, se presumirá su recepción conforme respecto de dichos aspectos, salvo prueba en contrario."
    ]
  },
  {
    "titulo": "DÉCIMA QUINTA. VICIOS OCULTOS Y DEFECTOS NO APARENTES.",
    "parrafos": [
      "Tratándose de defectos, vicios o circunstancias que razonablemente no pudieran ser detectados mediante una inspección ordinaria al momento de la recepción, “EL COMPRADOR” deberá notificar su existencia a “EL PROVEEDOR” dentro de un plazo razonable contado a partir de que tenga conocimiento de ellos.",
      "La reclamación deberá contener una descripción precisa del defecto y, cuando sea posible, evidencia documental, fotográfica, técnica o pericial que permita determinar su naturaleza.",
      "Recibida la reclamación, “LAS PARTES” deberán colaborar de buena fe para determinar si el defecto resulta imputable al producto suministrado, al transporte, almacenamiento, manipulación, instalación o utilización posterior de la mercancía.",
      "La presente cláusula no podrá interpretarse como una renuncia anticipada a derechos que por disposición legal sean irrenunciables."
    ]
  },
  {
    "titulo": "DÉCIMA SEXTA. DEVOLUCIONES.",
    "parrafos": [
      "Ninguna devolución de mercancía será procedente sin autorización previa y por escrito de “EL PROVEEDOR”, salvo los casos en que la legislación aplicable establezca un derecho distinto.",
      "Cuando una devolución sea autorizada, “EL COMPRADOR” deberá entregar la mercancía en las condiciones, cantidades, empaques y términos que determine “EL PROVEEDOR”.",
      "Los gastos de transporte, maniobra o devolución serán cubiertos por la parte a quien corresponda conforme a la causa que origine la devolución."
    ]
  },
  {
    "titulo": "DÉCIMA SÉPTIMA. RESERVA DE DOMINIO.",
    "parrafos": [
      "Cuando así se establezca expresamente en la cotización, factura y/o orden de compra “EL PROVEEDOR” conservará la propiedad de las mercancías suministradas hasta que éstas sean totalmente pagadas por “EL COMPRADOR”.",
      "La reserva de dominio se entenderá limitada a las mercancías respecto de las cuales haya sido expresamente pactada y será ejercida conforme a las disposiciones legales aplicables.",
      "La falta de pago facultará a “EL PROVEEDOR”, en los casos legalmente procedentes, para exigir el cumplimiento de la obligación o ejercer las acciones que correspondan respecto de las mercancías sujetas a reserva de dominio."
    ]
  },
  {
    "titulo": "DÉCIMA OCTAVA. GASTOS DE COBRANZA Y COSTAS.",
    "parrafos": [
      "En caso de incumplimiento, “EL COMPRADOR” deberá cubrir los gastos razonables y comprobables que “EL PROVEEDOR” erogue para realizar gestiones extrajudiciales de cobranza.",
      "Si resulta necesario acudir ante autoridad judicial, “EL COMPRADOR” responderá por las costas y gastos judiciales que, en su caso, sean determinados conforme a la legislación procesal aplicable y por resolución de autoridad competente."
    ]
  },
  {
    "titulo": "DÉCIMA NOVENA. INDEPENDENCIA DE LAS PARTES Y AUSENCIA DE RELACIÓN LABORAL.",
    "parrafos": [
      "“LAS PARTES” reconocen que son personas jurídicas independientes y que el presente contrato no constituye sociedad, asociación, mandato, comisión, agencia, representación comercial, relación laboral ni cualquier otra forma de asociación distinta de la relación mercantil expresamente pactada.",
      "Cada parte será responsable de su propio personal, trabajadores, empleados, contratistas, proveedores, transportistas y demás colaboradores.",
      "En consecuencia, cada parte asumirá exclusivamente las obligaciones laborales, fiscales y de seguridad social que legalmente le correspondan respecto de su propio personal.",
      "Ninguna de “LAS PARTES” podrá ostentarse como representante, agente o trabajador de la otra sin autorización expresa y por escrito."
    ]
  },
  {
    "titulo": "VIGÉSIMA. INDEMNIDAD.",
    "parrafos": [
      "“EL COMPRADOR” se obliga a mantener indemne a “EL PROVEEDOR” frente a reclamaciones que deriven directamente de actos u omisiones imputables a “EL COMPRADOR”, su personal, trabajadores, representantes, dependientes, transportistas o contratistas.",
      "La obligación anterior comprenderá, cuando resulte legalmente procedente, los gastos razonables y comprobables de defensa, honorarios profesionales, multas, sanciones, daños y perjuicios que deriven directamente del incumplimiento imputable.",
      "La presente obligación no comprenderá aquellos daños derivados de actos propios de “EL PROVEEDOR” o de responsabilidades que legalmente le correspondan."
    ]
  },
  {
    "titulo": "VIGÉSIMA PRIMERA. CONFIDENCIALIDAD.",
    "parrafos": [
      "“LAS PARTES” se obligan a mantener bajo estricta confidencialidad la información comercial, financiera, técnica, operativa, corporativa, estratégica y de cualquier otra naturaleza que reciban con motivo de la relación contractual.",
      "La obligación de confidencialidad subsistirá aun después de la terminación del presente contrato respecto de aquella información que por su naturaleza deba mantenerse reservada.",
      "No se considerará información confidencial aquella que sea pública, que haya sido obtenida legítimamente de terceros o cuya revelación sea exigida por autoridad competente."
    ]
  },
  {
    "titulo": "VIGÉSIMA SEGUNDA. NOTIFICACIONES.",
    "parrafos": [
      "Para todos los efectos relacionados con el presente contrato, “LAS PARTES” señalan como sus domicilios y medios de contacto para recibir toda clase de notificaciones, comunicaciones, requerimientos y avisos, los siguientes:",
      "{{NOTIFICACIONES}}",
      "“LAS PARTES” reconocen la validez de las comunicaciones efectuadas mediante correo electrónico respecto de pedidos, confirmaciones, aclaraciones, estados de cuenta, reclamaciones y demás comunicaciones de naturaleza operativa derivadas de la relación contractual.",
      "Cualquier modificación, actualización o cambio de los domicilios, correos electrónicos o demás datos de contacto anteriormente señalados deberá ser comunicado por escrito a la otra parte, con cuando menos tres días hábiles de anticipación, indicando expresamente los nuevos datos que deberán ser utilizados para efectos de notificaciones y comunicaciones.",
      "En caso de que cualquiera de “LAS PARTES” modifique, cambie o deje de utilizar alguno de los datos de contacto señalados en la presente cláusula sin notificarlo por escrito a la otra parte, las comunicaciones, avisos, requerimientos o notificaciones que se realicen a los datos previamente señalados continuarán considerándose válidamente efectuados y producirán todos los efectos legales y contractuales correspondientes, siempre que exista constancia de su envío."
    ]
  },
  {
    "titulo": "VIGÉSIMA TERCERA. MEDIOS ELECTRÓNICOS Y EVIDENCIA.",
    "parrafos": [
      "“LAS PARTES” reconocen como medios válidos de comunicación y acreditación de las operaciones los correos electrónicos, señalados en la cláusula que antecede, órdenes de compra digitales, archivos PDF, comprobantes electrónicos, mensajes de confirmación y demás mecanismos utilizados habitualmente en sus operaciones comerciales.",
      "Los registros electrónicos podrán ser utilizados como elementos probatorios respecto de la solicitud, aceptación, entrega, facturación y seguimiento de las operaciones, sujeto a las reglas de valoración probatoria aplicables."
    ]
  },
  {
    "titulo": "VIGÉSIMA CUARTA. CASO FORTUITO Y FUERZA MAYOR.",
    "parrafos": [
      "Ninguna de “LAS PARTES” será responsable por incumplimientos derivados directamente de acontecimientos imprevisibles o inevitables que constituyan caso fortuito o fuerza mayor, siempre que la parte afectada notifique oportunamente a la otra y realice esfuerzos razonables para mitigar sus efectos.",
      "La falta de liquidez, dificultades financieras o imposibilidad de obtener financiamiento no constituirán, por sí mismas, caso fortuito o fuerza mayor respecto de las obligaciones de pago de “EL COMPRADOR”."
    ]
  },
  {
    "titulo": "VIGÉSIMA QUINTA. CESIÓN.",
    "parrafos": [
      "“EL COMPRADOR” no podrá ceder, transmitir o transferir total o parcialmente sus derechos u obligaciones derivados del presente contrato sin autorización previa y por escrito de “EL PROVEEDOR”.",
      "“EL PROVEEDOR” podrá ceder los derechos de cobro derivados de las operaciones celebradas, notificando dicha circunstancia a “EL COMPRADOR” cuando legalmente resulte necesario."
    ]
  },
  {
    "titulo": "VIGÉSIMA SEXTA. VIGENCIA Y TERMINACIÓN.",
    "parrafos": [
      "El presente contrato tendrá una vigencia indefinida a partir de su fecha de firma hasta la entrega total de los productos.",
      "Cualquiera de “LAS PARTES” podrá solicitar su terminación mediante aviso escrito con cuando menos 30 (treinta) días naturales de anticipación.",
      "La terminación del contrato no extinguirá las obligaciones previamente causadas, por lo que “EL COMPRADOR” deberá cubrir íntegramente cualquier saldo pendiente, intereses y accesorios que correspondan.",
      "La terminación no afectará las garantías constituidas respecto de obligaciones que permanezcan pendientes de pago."
    ]
  },
  {
    "titulo": "VIGÉSIMA SÉPTIMA. RESCISIÓN.",
    "parrafos": [
      "“EL PROVEEDOR” podrá exigir la rescisión del presente contrato cuando “EL COMPRADOR” incurra en un incumplimiento esencial de cualquiera de sus obligaciones y, cuando resulte procedente, no subsane dicho incumplimiento dentro del plazo que razonablemente le sea otorgado.",
      "La rescisión no impedirá a “EL PROVEEDOR” exigir el pago de las cantidades vencidas, intereses, daños, perjuicios, gastos y demás accesorios legalmente procedentes."
    ]
  },
  {
    "titulo": "VIGÉSIMA OCTAVA. MODIFICACIONES.",
    "parrafos": [
      "Cualquier modificación, adición, ampliación o reducción de las obligaciones contenidas en el presente contrato deberá constar por escrito y estar debidamente aceptada por ambas partes."
    ]
  },
  {
    "titulo": "VIGÉSIMA NOVENA. INTEGRIDAD CONTRACTUAL.",
    "parrafos": [
      "El presente contrato, junto con sus anexos, solicitudes de crédito, órdenes de compra aceptadas y demás documentos expresamente incorporados al mismo, constituye el acuerdo integral entre “LAS PARTES” respecto de las operaciones objeto del presente instrumento.",
      "En caso de contradicción entre documentos, prevalecerá el presente contrato respecto de las condiciones generales, salvo que en el documento específico se establezca expresamente una condición particular y posterior aceptada por ambas partes."
    ]
  },
  {
    "titulo": "TRIGÉSIMA. NULIDAD PARCIAL.",
    "parrafos": [
      "Si alguna disposición del presente contrato fuese declarada nula, inválida o inaplicable por autoridad competente, dicha circunstancia no afectará la validez de las demás disposiciones.",
      "“LAS PARTES” procurarán sustituir la disposición afectada por otra jurídicamente válida que produzca, en la mayor medida posible, efectos económicos y jurídicos equivalentes."
    ]
  },
  {
    "titulo": "TRIGÉSIMA PRIMERA. LEGISLACIÓN APLICABLE Y JURISDICCIÓN.",
    "parrafos": [
      "Para la interpretación, cumplimiento, ejecución, terminación y, en su caso, resolución de cualquier controversia derivada del presente contrato, “LAS PARTES” se someten a las disposiciones del Código de Comercio y demás legislación mercantil federal aplicable.",
      "En aquello que no se encuentre expresamente regulado por la legislación mercantil, se estará a las disposiciones del derecho común aplicable en materia federal, en términos del artículo 2 del Código de Comercio.",
      "Para cualquier controversia que se suscite con motivo de la interpretación, cumplimiento o ejecución del presente contrato, “LAS PARTES” se someten expresamente a la competencia de los Tribunales competentes de la Heroica Puebla de Zaragoza, Estado de Puebla, renunciando expresamente al fuero que pudiera corresponderles debido a sus domicilios presentes o futuros o por cualquier otra causa.",
      "La presente elección de jurisdicción se realiza sin perjuicio de las reglas de competencia que resulten imperativas conforme a la legislación aplicable."
    ]
  },
  {
    "titulo": "TRIGÉSIMA SEGUNDA. TÍTULOS DE LAS CLÁUSULAS.",
    "parrafos": [
      "Los títulos utilizados en las cláusulas del presente contrato tienen exclusivamente fines de identificación y referencia, por lo que no deberán utilizarse para limitar, ampliar o modificar el contenido de las disposiciones contractuales."
    ]
  },
  {
    "titulo": "TRIGÉSIMA TERCERA. ANEXOS.",
    "parrafos": [
      "Forman parte integrante del presente contrato, para todos los efectos legales a que haya lugar, los siguientes documentos:",
      "• ANEXO “A”. Solicitud de Crédito Comercial.",
      "• ANEXO “B”. Pagaré, en su caso.",
      "• ANEXO “C”. Convenio de Aval y/o Obligación Solidaria, en su caso.",
      "Cualquier documento adicional que sea expresamente firmado por “LAS PARTES” y relacionado con las operaciones objeto del presente contrato podrá incorporarse como anexo mediante acuerdo escrito."
    ]
  },
  {
    "titulo": "TRIGÉSIMA CUARTA. ACEPTACIÓN.",
    "parrafos": [
      "Leído que fue el presente contrato por “LAS PARTES” y enteradas de su contenido, alcance y consecuencias legales, manifiestan que lo celebran de manera libre y voluntaria, sin que medie error, dolo, mala fe, violencia, lesión o cualquier otro vicio del consentimiento.",
      "{{FIRMA}}"
    ]
  }
];
