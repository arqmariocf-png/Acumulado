-- Plan del sistema (21-oct-2026, Mario: "te adjunto el excel para acomodo del
-- sistema, con toda la lógica de ventanas, menús y orden del sistema así como
-- los roles y acomodos"; eligió "reacomodo + tablero de avance"). Las 100
-- opciones de la hoja "Deber ser" de docs/deber-ser/Acumulado_deber_ser.xlsx
-- (7 grupos, 22 menús) con su estatus, fase, ruta y quién la usa; dirección
-- lleva aquí prioridad, responsable, fecha compromiso y avance. Las 16
-- opciones nuevas traen su especificación (hoja "Especificaciones").
-- Pantalla: Administración › Configuración › Plan del sistema
-- (pages/admin/PlanSistema.tsx, lib/planSistema.ts).
-- Ven y editan admin y dirección de la organización; alta y baja de
-- renglones, solo admin. Ya aplicado en producción (plan_sistema_1/_2).

create table if not exists public.plan_sistema (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  numero integer not null,
  grupo_menu text not null,
  menu text not null,
  opcion text not null,
  que_hace text,
  viene_de text,
  estatus text not null check (estatus in ('Existe', 'Unir', 'Ajustar', 'Validar', 'Crear', 'Migrar del backoffice', 'Por definir', 'Hecho')),
  ruta text,
  fase smallint check (fase between 1 and 3),
  quien text,
  prioridad text check (prioridad in ('alta', 'media', 'baja')),
  responsable text,
  fecha_compromiso date,
  avance smallint not null default 0 check (avance between 0 and 100),
  notas text,
  especificacion jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (grupo_id, numero)
);

comment on table public.plan_sistema is 'Plan del sistema: las opciones del deber ser (grupo › menú › opción) con estatus, fase, responsable y avance.';

create or replace function public.plan_sistema_antes()
returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists plan_sistema_antes on public.plan_sistema;
create trigger plan_sistema_antes before insert or update on public.plan_sistema
  for each row execute function public.plan_sistema_antes();

alter table public.plan_sistema enable row level security;

drop policy if exists plan_sistema_select on public.plan_sistema;
create policy plan_sistema_select on public.plan_sistema for select to authenticated
  using ((select public.auth_rol_definer()) in ('admin', 'direccion')
         and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists plan_sistema_update on public.plan_sistema;
create policy plan_sistema_update on public.plan_sistema for update to authenticated
  using ((select public.auth_rol_definer()) in ('admin', 'direccion')
         and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check ((select public.auth_rol_definer()) in ('admin', 'direccion')
              and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists plan_sistema_insert on public.plan_sistema;
create policy plan_sistema_insert on public.plan_sistema for insert to authenticated
  with check ((select public.auth_rol_definer()) = 'admin'
              and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists plan_sistema_borrar on public.plan_sistema;
create policy plan_sistema_borrar on public.plan_sistema for delete to authenticated
  using ((select public.auth_rol_definer()) = 'admin'
         and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists frontera_organizacion on public.plan_sistema;
create policy frontera_organizacion on public.plan_sistema as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists espectador_sin_datos on public.plan_sistema;
create policy espectador_sin_datos on public.plan_sistema as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));

drop policy if exists director_general on public.plan_sistema;
create policy director_general on public.plan_sistema for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));

drop trigger if exists solo_consulta on public.plan_sistema;
create trigger solo_consulta before insert or update or delete on public.plan_sistema
  for each statement execute function public.bloquear_solo_consulta();

grant select, insert, update, delete on public.plan_sistema to authenticated;

-- Siembra: las 100 opciones del Excel para la organización maestra.
insert into public.plan_sistema (grupo_id, numero, grupo_menu, menu, opcion, que_hace, viene_de, estatus, ruta, fase, quien, especificacion)
select g.id, v.numero, v.grupo_menu, v.menu, v.opcion, v.que_hace, v.viene_de, v.estatus, v.ruta, v.fase, v.quien, v.especificacion
  from public.grupos g
  cross join (values
  (1, 'Mi día', 'Mi día', 'Inicio', 'Mis pendientes y alertas del día según mi puesto', 'Match 1.a, 1.d', 'Ajustar', '/', 1, 'Todos', null),
  (2, 'Mi día', 'Mi día', 'Mis tareas', 'Una sola lista de actividades con filtro por área', 'Fuera: Tareas y 9 Tareas de área', 'Unir', '/tareas', 1, 'Todos', null),
  (3, 'Mi día', 'Mi día', 'Checador', 'Entrada, comida y salida con foto y ubicación; alimenta Asistencia', 'Fuera: Checador', 'Existe', '/checador', 1, 'Todos', null),
  (4, 'Mi día', 'Mi día', 'Comedor', 'Pedido de comida con descuento vía nómina', 'Fuera: Comedor', 'Existe', '/comedor', 2, 'Todos', null),
  (5, 'Mi día', 'Mi día', 'Mi perfil', 'Personaje, QR, contrato y documentos por firmar en una sola pantalla', 'Fuera: Mi personaje, Mis documentos', 'Unir', '/personaje; /mis-documentos', 2, 'Todos', null),
  (6, 'Dirección', 'Tablero', 'Resumen del grupo', 'KPIs con semáforo contra presupuesto y año anterior; clic para bajar de grupo a empresa, centro y documento', 'Match 1.b', 'Ajustar', '/dashboard', 1, 'Dirección, Finanzas', '{"empresas": "Todas", "para_que": "Que el CEO vea en una pantalla cómo va el grupo y pueda bajar hasta el documento que explica cada número.", "pestanas": "Grupo · Por empresa · Por centro de beneficio", "datos": "No se captura: se alimenta de Tesorería, Cobranza, Cuentas por pagar, Presupuestos y Obras. KPIs: saldo en bancos, flujo a 13 semanas, ventas, margen, cartera vencida, pagos por vencer, avance de obras, nómina.", "reglas": "Cada KPI con semáforo contra presupuesto y año anterior. Clic en un número: grupo › empresa › centro › documento. Mismo número en todas las pantallas (una sola fuente).", "conecta": "Todos los módulos; Centros de costo y de beneficio; Presupuestos", "quien": "Dirección general · Socios (consulta)"}'::jsonb),
  (7, 'Dirección', 'Tablero', 'Bandeja de aprobaciones', 'Todo lo que espera al CEO en un solo lugar: OC, pagos, nóminas, estimaciones y préstamos entre empresas', 'Fuera: Órdenes por autorizar; Nuevo: criterio SAP', 'Ajustar', '/finanzas/por-autorizar', 1, 'Dirección', '{"empresas": "Todas", "para_que": "Que todo lo que requiere visto bueno de dirección esté en un solo lugar, con el contexto para decidir.", "pestanas": "Pendientes · Aprobadas · Rechazadas", "datos": "Documento, empresa, monto, quién lo pide, presupuesto disponible, historial con ese proveedor o empleado.", "reglas": "Llega según la Matriz de autorizaciones. Aprobar o rechazar con comentario, también desde el celular. Lo rechazado regresa a quien lo capturó.", "conecta": "Matriz de autorizaciones, Órdenes de compra, Programación de pagos, Nómina, Contratos y estimaciones", "quien": "Dirección general y autorizadores"}'::jsonb),
  (8, 'Dirección', 'Tablero', 'Alertas de dirección', 'Solo excepciones: flujo en rojo, obras desviadas, cobros vencidos, opiniones fiscales negativas', 'Nuevo: criterio SAP', 'Crear', null, 1, 'Dirección', null),
  (9, 'Dirección', 'Tablero', 'Seguimiento de obras', 'Avance físico contra avance financiero por obra', 'Match 1.c, 6.e', 'Existe', '/finanzas/obras', 1, 'Dirección, Obra', null),
  (10, 'Dirección', 'Análisis', 'Estado de resultados', 'Real contra presupuesto y año anterior, por empresa y consolidado, con drill-down a la póliza o documento', 'Match 15.d', 'Crear', null, 2, 'Dirección, Finanzas', null),
  (11, 'Dirección', 'Análisis', 'Rentabilidad por centro de beneficio', 'Utilidad por empresa, obra y línea de negocio (materiales, fábricas, fletes, TI)', 'Nuevo: criterio SAP', 'Crear', null, 2, 'Dirección, Finanzas', '{"empresas": "Todas", "para_que": "Saber qué empresa, obra o línea de negocio deja dinero y cuál no.", "pestanas": "Por empresa · Por obra · Por línea de negocio", "datos": "No se captura: ingresos y gastos asignados a cada centro de beneficio.", "reglas": "Margen real contra presupuesto. Las operaciones entre empresas se muestran aparte para no inflar la utilidad.", "conecta": "Centros de costo y de beneficio, Estado de resultados, Eliminaciones entre empresas", "quien": "Dirección · Finanzas"}'::jsonb),
  (12, 'Dirección', 'Análisis', 'Comparativo entre empresas', 'Las 8 empresas lado a lado: ventas, margen, gasto, flujo y cartera', 'Nuevo: criterio SAP', 'Crear', null, 2, 'Dirección', null),
  (13, 'Dirección', 'Análisis', 'Reportes', 'Ingresos, ingresos y egresos por proyecto, compras vs ventas, historial y reportes especiales en pestañas', 'Match 15.a, 15.b, 15.c, 15.e; Fuera: Reportes especiales', 'Migrar del backoffice', '/reportes', 2, 'Dirección, Finanzas', null),
  (14, 'Dirección', 'Gobierno', 'Metas y objetivos', 'Metas anuales por empresa y área, con avance automático desde los datos del sistema', 'Nuevo: criterio SAP', 'Crear', null, 2, 'Dirección', '{"empresas": "Todas", "para_que": "Que las metas anuales del grupo se midan solas con los datos del sistema.", "pestanas": "Metas del año · Avance · Histórico", "datos": "Meta, empresa o área, indicador (ligado a un KPI del sistema), valor objetivo, responsable, periodo.", "reglas": "El avance se calcula solo; nadie lo captura a mano.", "conecta": "Resumen del grupo, Presupuestos, Organigrama", "quien": "Dirección · jefes de área (consulta)"}'::jsonb),
  (15, 'Dirección', 'Gobierno', 'Acuerdos de junta', 'Acuerdos de dirección con responsable, fecha y seguimiento ligado a Mis tareas', 'Nuevo: criterio SAP', 'Crear', null, 2, 'Dirección', '{"empresas": "Grupo", "para_que": "Que los acuerdos de dirección no se pierdan y tengan seguimiento.", "pestanas": "Juntas · Acuerdos · Pendientes", "datos": "Fecha de junta, asistentes, acuerdo, responsable, fecha compromiso, estatus.", "reglas": "Cada acuerdo crea una tarea en Mis tareas del responsable.", "conecta": "Mis tareas, Organigrama", "quien": "Dirección"}'::jsonb),
  (16, 'Dirección', 'Gobierno', 'Vista de socio', 'Lo que consulta cada socio', 'Fuera: Socio', 'Existe', '/socio', 2, 'Socios', null),
  (17, 'Comercial', 'Ventas', 'Cotizaciones', 'Cotizar a clientes de cualquier empresa', 'Match 2.a', 'Existe', '/cotizador', 1, 'Ventas', null),
  (18, 'Comercial', 'Ventas', 'CRM', 'Contactos de WhatsApp y redes, seguimiento y canales de venta', 'Fuera: CRM de ventas; Match 16.g', 'Ajustar', '/ventas/crm', 2, 'Ventas', null),
  (19, 'Comercial', 'Ventas', 'Órdenes de venta', 'OV a clientes externos y a empresas del grupo (tipo: entre empresas)', 'Match 2.b, 2.f', 'Ajustar', '/ordenes?tipo=OV', 1, 'Ventas', null),
  (20, 'Comercial', 'Ventas', 'Facturación', 'Facturas y notas de crédito ligadas a la OV', 'Match 2.c, 2.d', 'Migrar del backoffice', null, 1, 'Ventas, Contabilidad', null),
  (21, 'Comercial', 'Ventas', 'Rentas y leasing', 'Contratos de renta y leasing con su calendario de cobro', 'Match 2.e', 'Crear', null, 3, 'Ventas, Finanzas', null),
  (22, 'Comercial', 'Ventas', 'Acumulado', 'Definir qué debe mostrar antes de programarlo', 'Match 2.g', 'Por definir', null, 2, 'Por definir', null),
  (23, 'Comercial', 'Cobranza', 'Cuentas por cobrar', 'Saldo por cliente con antigüedad (al corriente, 30, 60, 90+ días)', 'Match 3.a, 3.b', 'Crear', null, 1, 'Finanzas, Ventas', null),
  (24, 'Comercial', 'Cobranza', 'Registro de cobros', 'Aplicar depósitos del banco a facturas', 'Match 3.c', 'Crear', null, 1, 'Finanzas', null),
  (25, 'Comercial', 'Cobranza', 'Crédito a clientes', 'Línea, días de crédito y contrato por cliente', 'Match 3.d', 'Ajustar', '/legal?tab=credito', 2, 'Finanzas, Legal', null),
  (26, 'Comercial', 'Compras', 'Requisiciones', 'Solicitudes de material de obra o almacén', 'Match 4.a', 'Existe', '/requisiciones', 1, 'Obra, Almacén, Compras', null),
  (27, 'Comercial', 'Compras', 'Órdenes de compra y servicio', 'OC/OS con estado, editar y cancelar; tipo entre empresas para AEP', 'Match 4.b, 4.c, 4.e', 'Validar', '/ordenes', 1, 'Compras', null),
  (28, 'Comercial', 'Compras', 'Confirmar factura', 'Ligar el CFDI del proveedor a su OC', 'Match 4.d', 'Validar', '/carga', 1, 'Compras, Contabilidad', null),
  (29, 'Comercial', 'Almacén', 'Por recibir', 'OC pagadas pendientes de llegar, con avance por partida', 'Match 8.b; Fuera: Por recibir, Match con OC/OV', 'Unir', '/inventario/por-recibir; /inventario/match', 1, 'Almacén', null),
  (30, 'Comercial', 'Almacén', 'Entradas y salidas', 'Registrar movimientos contra la OC o la OV', 'Match 8.b, 8.c', 'Existe', '/inventario', 1, 'Almacén', null),
  (31, 'Comercial', 'Almacén', 'Remisiones', 'Entregas de almacén a obra o cliente con QR', 'Match 8.c', 'Existe', '/inventario/remisiones', 1, 'Almacén, Logística', null),
  (32, 'Comercial', 'Almacén', 'Existencias', 'Lo que hay por almacén, valor por empresa y kardex por artículo', 'Match 8.a, 8.f; Fuera: Resumen de inventario', 'Ajustar', '/inventario/existencias; /inventario/resumen', 1, 'Almacén, Compras', null),
  (33, 'Comercial', 'Almacén', 'Traspasos entre empresas', 'Mover material de AEP a otra empresa con su venta interna', 'Match 8.d', 'Crear', null, 2, 'Almacén', null),
  (34, 'Comercial', 'Almacén', 'Inventario físico', 'Conteo y ajuste contra sistema', 'Match 8.e', 'Crear', null, 2, 'Almacén', null),
  (35, 'Comercial', 'Almacén', 'Herramienta y equipo', 'Piezas con folio, préstamos a obra y resguardos', 'Fuera: Herramienta y equipo', 'Existe', '/almacen/herramienta', 2, 'Almacén, Obra', null),
  (36, 'Finanzas', 'Tesorería', 'Pagos de hoy', 'Semáforo por empresa y pagos del día con datos bancarios', 'Match 5.c', 'Existe', '/finanzas/tesoreria', 1, 'Tesorería', null),
  (37, 'Finanzas', 'Tesorería', 'Programación de pagos', 'Calendario de pagos por empresa', 'Match 5.b', 'Existe', '/finanzas/pagos', 1, 'Tesorería', null),
  (38, 'Finanzas', 'Tesorería', 'Bancos y saldos', 'Saldos por empresa y por cuenta en una pantalla con pestañas', 'Match 5.e', 'Unir', '/finanzas/saldos; /saldos', 1, 'Tesorería, Dirección', null),
  (39, 'Finanzas', 'Tesorería', 'Conciliación bancaria', 'Movimientos del banco contra CFDI y pagos', 'Match 5.f', 'Existe', '/movimientos', 1, 'Tesorería, Contabilidad', null),
  (40, 'Finanzas', 'Tesorería', 'Efectivo', 'OC pagadas en efectivo y retiros de caja', 'Match 5.d; Fuera: Efectivo por confirmar', 'Ajustar', '/finanzas/efectivo', 1, 'Tesorería', null),
  (41, 'Finanzas', 'Tesorería', 'Flujo de efectivo', 'Entradas y salidas proyectadas por semana, por empresa y global', 'Match 5.g', 'Crear', null, 1, 'Tesorería, Dirección', null),
  (42, 'Finanzas', 'Tesorería', 'Préstamos entre empresas', 'Dinero que una empresa presta a otra y su saldo', 'Fuera: Préstamos entre empresas', 'Existe', '/prestamos-intercompania', 1, 'Tesorería', null),
  (43, 'Finanzas', 'Cuentas por pagar', 'Saldos por proveedor', 'Lo que se debe por proveedor y empresa, con vencimientos', 'Match 5.a', 'Existe', '/finanzas/proveedores', 1, 'Tesorería, Compras', null),
  (44, 'Finanzas', 'Cuentas por pagar', 'Líneas de crédito de proveedores', 'Monto, días y uso por proveedor', 'Fuera: Líneas de crédito', 'Existe', '/finanzas/lineas-credito', 1, 'Tesorería, Compras', null),
  (45, 'Finanzas', 'Cuentas por pagar', 'Comprobación de gastos', 'Caja chica y gastos de obra con factura o nota', 'Fuera: Comprobación de gastos', 'Existe', '/gastos', 1, 'Todos los que comprueban', null),
  (46, 'Finanzas', 'Cuentas por pagar', 'Base de OC y pagos', 'Historial de OC, pagos y comprobantes', 'Fuera: Base de OC y pagos', 'Existe', '/finanzas/historial-pagos', 1, 'Tesorería, Contabilidad', null),
  (47, 'Finanzas', 'Cuentas por pagar', 'Comisiones', 'Pagos, histórico y beneficiarios en pestañas', 'Match 12.a, 12.b, 12.c', 'Migrar del backoffice', null, 2, 'Finanzas', null),
  (48, 'Finanzas', 'Cuentas por pagar', 'Créditos bancarios', 'Préstamos externos, pago a capital y beneficiarios', 'Match 13.a, 13.b', 'Migrar del backoffice', null, 2, 'Finanzas', null),
  (49, 'Finanzas', 'Presupuestos', 'Presupuesto anual', 'Por empresa y por concepto de ingreso y egreso', 'Match 14.a', 'Crear', null, 1, 'Finanzas, Dirección', null),
  (50, 'Finanzas', 'Presupuestos', 'Presupuesto por obra', 'Materiales, mano de obra y utilidad esperada por obra', 'Match 14.b', 'Crear', null, 1, 'Finanzas, Obra', null),
  (51, 'Finanzas', 'Presupuestos', 'Presupuesto contra real', 'Lo presupuestado contra lo facturado y ejercido', 'Match 14.c', 'Crear', null, 1, 'Finanzas, Dirección', null),
  (52, 'Finanzas', 'Presupuestos', 'Utilidad por proyecto', 'Porcentaje de utilidad real contra meta', 'Match 14.d', 'Crear', null, 2, 'Dirección', null),
  (53, 'Finanzas', 'Contabilidad', 'Carga de archivos', 'Estados de cuenta, CFDI y catálogo de OC/OV', 'Fuera: Carga de archivos', 'Existe', '/carga', 1, 'Contabilidad', null),
  (54, 'Finanzas', 'Contabilidad', 'Pendientes', 'Concentrado de pendientes por proveedor', 'Fuera: Pendientes', 'Existe', '/pendientes', 1, 'Contabilidad', null),
  (55, 'Finanzas', 'Contabilidad', 'Perfil fiscal', 'Datos fiscales y parámetros de cada empresa', 'Fuera: Perfil fiscal; Match 17.d', 'Existe', '/perfil-fiscal', 1, 'Contabilidad', null),
  (56, 'Finanzas', 'Contabilidad', 'Cumplimiento fiscal', 'Calendario de declaraciones, opinión de cumplimiento y DIOT por empresa', 'Nuevo: necesidad del grupo', 'Crear', null, 1, 'Contabilidad', '{"empresas": "Las 8 razones sociales", "para_que": "No vencer obligaciones ante el SAT, IMSS e Infonavit en ninguna empresa.", "pestanas": "Calendario · Opiniones de cumplimiento · DIOT · Expediente fiscal", "datos": "Obligación, empresa, periodicidad, fecha límite, responsable, estatus, acuse en PDF, fecha de la última opinión de cumplimiento (SAT, IMSS, Infonavit).", "reglas": "Avisa 5 días antes del vencimiento. Una opinión negativa aparece como alerta en Inicio de Dirección y Contabilidad.", "conecta": "Perfil fiscal, Carga de archivos, Inicio (alertas)", "quien": "Contabilidad (captura) · Dirección (consulta)"}'::jsonb),
  (57, 'Finanzas', 'Contabilidad', 'Eliminaciones entre empresas', 'Cuadra ventas, compras y préstamos entre empresas para el consolidado', 'Nuevo: necesidad del grupo', 'Crear', null, 2, 'Contabilidad, Dirección', '{"empresas": "Todas", "para_que": "Que el consolidado no sume dos veces lo que una empresa le vende, compra o presta a otra.", "pestanas": "Operaciones por cuadrar · Diferencias · Resumen para consolidado", "datos": "Se alimenta solo de OV, OC, traspasos y préstamos marcados como entre empresas. Empresa que vende, empresa que compra, monto, mes.", "reglas": "Lo vendido por una debe igualar lo comprado por la otra; si no, aparece como diferencia por revisar. El estado de resultados consolidado resta lo cuadrado.", "conecta": "Órdenes de venta, Órdenes de compra, Traspasos entre empresas, Préstamos entre empresas, Estado de resultados", "quien": "Contabilidad (cuadra) · Dirección (consulta)"}'::jsonb),
  (58, 'Finanzas', 'Contabilidad', 'Activos fijos', 'Maquinaria, camiones y equipo con resguardo y depreciación', 'Nuevo: necesidad del grupo', 'Crear', null, 2, 'Contabilidad, Almacén, Logística', '{"empresas": "Todas; más peso en Loma Racing, Clavicon, Balken y constructoras", "para_que": "Saber qué activos tiene cada empresa, dónde están, quién los tiene y cuánto valen.", "pestanas": "Inventario de activos · Resguardos · Depreciación · Bajas", "datos": "Activo, empresa dueña, categoría (maquinaria, vehículo, equipo de obra, cómputo), factura, costo, fecha de compra, ubicación u obra, responsable, tasa de depreciación, número de serie o placa.", "reglas": "Depreciación mensual automática. Un activo prestado a otra empresa queda registrado como préstamo entre empresas. Las unidades de Loma Racing se ligan con Fletes.", "conecta": "Herramienta y equipo, Unidades y mantenimiento, Seguros y fianzas, Contabilidad", "quien": "Contabilidad (alta y depreciación) · Almacén o Jefe de flota (resguardo)"}'::jsonb),
  (59, 'Finanzas', 'Contabilidad', 'Cierre del mes', 'Checklist de cierre por empresa; al cerrar, el periodo queda bloqueado', 'Nuevo: criterio SAP', 'Crear', null, 2, 'Contabilidad, Dirección', '{"empresas": "Las 8 razones sociales", "para_que": "Cerrar cada mes con las mismas reglas en todas las empresas.", "pestanas": "Checklist · Estatus por empresa · Periodos cerrados", "datos": "Paso del cierre (conciliaciones, provisiones, depreciación, eliminaciones), empresa, responsable, fecha.", "reglas": "Al cerrar un periodo nadie puede capturar ni modificar documentos con esa fecha.", "conecta": "Conciliación bancaria, Activos fijos, Eliminaciones entre empresas, Estado de resultados", "quien": "Contabilidad · Dirección (consulta)"}'::jsonb),
  (60, 'Operación', 'Obras', 'Proyectos', 'Obras con categoría, estatus, planos y avance', 'Match 6.a, 6.b, 6.c', 'Ajustar', '/proyectos', 1, 'Obra, Dirección', null),
  (61, 'Operación', 'Obras', 'Contratos y estimaciones', 'Contrato por obra con anticipo, estimaciones, retenciones, fianzas y finiquito', 'Nuevo: necesidad del grupo', 'Crear', null, 1, 'Obra, Finanzas, Legal', '{"empresas": "CSC, Ergodinova, Mario Contreras Farfán", "para_que": "Controlar cada obra desde el contrato hasta el finiquito, y saber cuánto se ha estimado, cobrado y retenido.", "pestanas": "Contratos · Estimaciones · Anticipos · Retenciones y fianzas · Finiquito", "datos": "Cliente, obra, monto contratado, IVA, % de anticipo, amortización del anticipo por estimación, retenciones (fondo de garantía, 5 al millar en obra pública), fianzas (anticipo, cumplimiento, vicios ocultos), convenios modificatorios, periodo y volumen estimado por concepto.", "reglas": "Una estimación no puede exceder lo contratado más convenios. El anticipo se amortiza en cada estimación. Al autorizar una estimación se genera la factura y la cuenta por cobrar.", "conecta": "Proyectos, Precios unitarios, Facturación, Cuentas por cobrar, Seguros y fianzas, Presupuesto por obra", "quien": "Residente (captura) · Finanzas (autoriza y factura) · Legal (contrato y fianzas)"}'::jsonb),
  (62, 'Operación', 'Obras', 'Precios unitarios e items por obra', 'Catálogo de insumos, análisis de precio unitario e importación de items', 'Fuera: Precios unitarios; Match 6.d', 'Ajustar', '/precios', 1, 'Obra, Compras', null),
  (63, 'Operación', 'Obras', 'Calificación de proyectos', 'Capturar, revisar y graficar calificaciones', 'Match 6.f', 'Migrar del backoffice', null, 3, 'Dirección, Obra', null),
  (64, 'Operación', 'Producción', 'Órdenes de producción', 'Qué se fabrica, cuánto y para cuándo (Clavicon y Balken)', 'Match 9.a', 'Crear', null, 3, 'Producción', null),
  (65, 'Operación', 'Producción', 'Consumos y mermas', 'Materia prima usada y desperdicio por orden', 'Match 9.b, 9.d', 'Crear', null, 3, 'Producción, Almacén', null),
  (66, 'Operación', 'Producción', 'Producto terminado', 'Entrada al almacén de lo fabricado', 'Match 9.c', 'Crear', null, 3, 'Producción, Almacén', null),
  (67, 'Operación', 'Producción', 'Costo de producción', 'Costo real por pieza o tonelada', 'Match 9.e', 'Crear', null, 3, 'Producción, Finanzas', null),
  (68, 'Operación', 'Fletes', 'Viajes y servicios', 'Viajes de Loma Racing, a qué empresa o cliente y su cobro', 'Match 10.a', 'Crear', null, 3, 'Logística', null),
  (69, 'Operación', 'Fletes', 'Unidades y mantenimiento', 'Camiones, servicios y vencimientos', 'Match 10.b, 10.e', 'Crear', null, 3, 'Logística', null),
  (70, 'Operación', 'Fletes', 'Choferes', 'Asignación y viajes por chofer', 'Match 10.c', 'Crear', null, 3, 'Logística', null),
  (71, 'Operación', 'Fletes', 'Combustible', 'Cargas y rendimiento por unidad', 'Match 10.d', 'Crear', null, 3, 'Logística', null),
  (72, 'Operación', 'Mantenimiento BBVA', 'Control BBVA', 'Folios, estatus por paso y conciliación', 'Fuera: Control BBVA', 'Existe', '/mantenimiento/bbva', 1, 'Operación BBVA', null),
  (73, 'Operación', 'Mantenimiento BBVA', 'Folios', 'Semáforo de atención de cuadrillas', 'Fuera: Folios BBVA', 'Existe', '/bbva/folios', 1, 'Operación BBVA', null),
  (74, 'Operación', 'Mantenimiento BBVA', 'Punto de equilibrio', 'Gasto del equipo contra folios cobrados', 'Fuera: Punto de equilibrio BBVA', 'Existe', '/bbva/equilibrio', 1, 'Operación BBVA, Dirección', null),
  (75, 'Nómina y mano de obra', 'Nómina', 'Generar nómina', 'Calcula la nómina por empresa con asistencia, incidencias y descuentos', 'Match 11.e', 'Migrar del backoffice', null, 1, 'RH, Finanzas', null),
  (76, 'Nómina y mano de obra', 'Nómina', 'Nóminas y recibos', 'Nóminas generadas, recibos timbrados y dispersión por empresa', 'Match 11.f', 'Migrar del backoffice', null, 1, 'RH, Finanzas', null),
  (77, 'Nómina y mano de obra', 'Nómina', 'Historial de pagos', 'Pagos de nómina por empleado, periodo y empresa', 'Match 11.g', 'Migrar del backoffice', null, 1, 'RH, Finanzas', null),
  (78, 'Nómina y mano de obra', 'Nómina', 'Préstamos y descuentos', 'Cuentas de nómina, financiamiento a empleados y descuentos vía nómina', 'Fuera: Cuentas de nómina y financiamiento', 'Existe', '/financiamiento', 2, 'RH', null),
  (79, 'Nómina y mano de obra', 'Mano de obra', 'Solicitudes', 'Pedir pago a contratistas y exportar la lista', 'Match 7.a, 7.b', 'Migrar del backoffice', null, 1, 'Obra', null),
  (80, 'Nómina y mano de obra', 'Mano de obra', 'Avances', 'Avance de cada partida contra lo pagado', 'Match 7.c', 'Migrar del backoffice', null, 1, 'Obra, Finanzas', null),
  (81, 'Nómina y mano de obra', 'Mano de obra', 'Pagos e informes', 'Historial de pagos de mano de obra', 'Match 7.d', 'Migrar del backoffice', null, 1, 'Finanzas', null),
  (82, 'Nómina y mano de obra', 'Mano de obra', 'Configuración de partidas', 'Habilitar obra, partidas y conceptos en un asistente de pasos', 'Match 7.e', 'Migrar del backoffice', null, 1, 'Obra', null),
  (83, 'Administración', 'Recursos humanos', 'Expediente del empleado', 'Datos, empresa, puesto, jefe directo, documentos y su descripción de puesto', 'Match 11.a, 11.b', 'Migrar del backoffice', null, 1, 'RH; cada jefe ve a su equipo', null),
  (84, 'Administración', 'Recursos humanos', 'Descripciones de puesto', 'Objetivo, funciones, indicadores, perfil y a quién reporta cada puesto', 'Nuevo: petición de dirección', 'Crear', null, 1, 'RH, Dirección', '{"empresas": "Todas", "para_que": "Que cada empleado sepa qué se espera de él y que cada puesto tenga un perfil claro.", "pestanas": "Catálogo de puestos · Descripción · Versiones", "datos": "Puesto, empresa, área, a quién reporta, objetivo, funciones, indicadores, perfil (escolaridad, experiencia, competencias), rango salarial, documento firmado.", "reglas": "Cada empleado tiene un puesto; su expediente muestra la descripción vigente. Un cambio de descripción guarda versión y pide firma.", "conecta": "Expediente del empleado, Organigrama, Vacantes, Mis documentos", "quien": "RH (captura) · empleado y jefe (consulta)"}'::jsonb),
  (85, 'Administración', 'Recursos humanos', 'Organigrama', 'Árbol por grupo y por empresa que se arma solo desde el expediente; muestra puestos vacantes', 'Nuevo: petición de dirección', 'Crear', null, 1, 'Todos (consulta), RH', '{"empresas": "Todas", "para_que": "Ver quién reporta a quién en el grupo y en cada empresa.", "pestanas": "Grupo · Por empresa · Por área", "datos": "No se captura: se arma con el jefe directo de cada expediente.", "reglas": "Clic en una persona abre su descripción de puesto. Puestos sin ocupante aparecen como vacantes y enlazan a la vacante.", "conecta": "Expediente del empleado, Descripciones de puesto, Vacantes", "quien": "Todos (consulta) · RH"}'::jsonb),
  (86, 'Administración', 'Recursos humanos', 'Vacantes', 'Vacantes abiertas por empresa y puesto, candidatos, etapa y días abierta', 'Nuevo: petición de dirección', 'Crear', null, 1, 'RH, Dirección, jefes que solicitan', '{"empresas": "Todas", "para_que": "Saber qué puestos están abiertos, en qué etapa va cada uno y cuánto tiempo llevan.", "pestanas": "Vacantes abiertas · Candidatos · Cerradas", "datos": "Puesto (ligado a su descripción), empresa, área, quién lo solicita, motivo (nueva o reemplazo), sueldo, fecha de apertura, candidatos, etapa (solicitud, búsqueda, entrevistas, oferta, contratado).", "reglas": "Toda vacante nueva pasa por la Matriz de autorizaciones. Al contratar, el candidato se convierte en expediente sin volver a capturar. Días abierta con semáforo.", "conecta": "Descripciones de puesto, Organigrama, Expediente del empleado, Bandeja de aprobaciones", "quien": "RH · Dirección · jefes que solicitan"}'::jsonb),
  (87, 'Administración', 'Recursos humanos', 'Asistencia e incidencias', 'Lo que registra el checador más faltas, permisos y vacaciones', 'Match 11.c, 11.d', 'Ajustar', '/checador', 1, 'RH', null),
  (88, 'Administración', 'Legal y cumplimiento', 'Asuntos y contratos', 'Juicios, contratos y crédito a clientes', 'Fuera: Legal', 'Existe', '/legal', 2, 'Legal', null),
  (89, 'Administración', 'Legal y cumplimiento', 'Cumplimiento', 'Normas, controles, incidencias e informe al comité', 'Fuera: Cumplimiento', 'Existe', '/cumplimiento', 2, 'Legal, Dirección', null),
  (90, 'Administración', 'Legal y cumplimiento', 'Seguros y fianzas', 'Pólizas de unidades, obras y equipo con vencimientos y avisos', 'Nuevo: necesidad del grupo', 'Crear', null, 2, 'Legal, Finanzas', '{"empresas": "Todas", "para_que": "Que ninguna unidad, obra o equipo quede sin seguro ni fianza vigente.", "pestanas": "Pólizas · Fianzas · Vencimientos · Siniestros", "datos": "Aseguradora o afianzadora, póliza, empresa, qué cubre (unidad, obra, equipo, responsabilidad civil), vigencia, prima, beneficiario, documento PDF.", "reglas": "Avisa 30 días antes del vencimiento. Las fianzas de obra se crean desde el contrato. Un siniestro abierto queda como alerta hasta cerrarse.", "conecta": "Contratos y estimaciones, Activos fijos, Unidades y mantenimiento, Cuentas por pagar", "quien": "Legal (captura) · Finanzas (paga primas)"}'::jsonb),
  (91, 'Administración', 'Catálogos', 'Empresas', 'Razón social, RFC, domicilio y cuentas', 'Match 16.a', 'Existe', '/catalogos/empresas', 1, 'TI, Contabilidad', null),
  (92, 'Administración', 'Catálogos', 'Clientes y obras', 'Clientes con sus obras relacionadas', 'Match 16.b', 'Validar', '/catalogos/clientes', 1, 'Ventas, TI', null),
  (93, 'Administración', 'Catálogos', 'Proveedores y costos', 'Proveedores, precios de lista e histórico de costos', 'Match 16.c, 16.h', 'Existe', '/compras/catalogo', 1, 'Compras', null),
  (94, 'Administración', 'Catálogos', 'Productos e items', 'Productos por empresa, categorías y grupos de materiales', 'Match 16.e, 16.f; Fuera: Productos', 'Unir', '/compras/items; /inventario/productos', 1, 'Compras, Almacén', null),
  (95, 'Administración', 'Catálogos', 'Contratistas', 'Contratistas y sus puestos', 'Match 16.d', 'Migrar del backoffice', null, 1, 'Obra, RH', null),
  (96, 'Administración', 'Catálogos', 'Centros de costo y de beneficio', 'Estructura empresa › área u obra › centro; cada gasto e ingreso se asigna a uno', 'Nuevo: criterio SAP', 'Crear', null, 1, 'Finanzas, TI', '{"empresas": "Todas", "para_que": "La base del criterio SAP: que cada peso de gasto o ingreso tenga dueño.", "pestanas": "Estructura · Responsables", "datos": "Empresa (sociedad), centro de beneficio (obra, línea de negocio), centro de costo (área: administración, almacén, flota, producción), responsable.", "reglas": "Toda OC, OS, nómina, factura y gasto lleva centro obligatorio. Un centro solo pertenece a una empresa.", "conecta": "Órdenes de compra, Nómina, Facturación, Comprobación de gastos, Presupuestos", "quien": "Finanzas (define) · TI (configura)"}'::jsonb),
  (97, 'Administración', 'Configuración', 'Usuarios y permisos', 'Usuarios, roles y qué módulos ve cada quien', 'Match 17.a, 17.b', 'Validar', null, 1, 'TI', null),
  (98, 'Administración', 'Configuración', 'Matriz de autorizaciones', 'Quién autoriza OC, pagos y nóminas según monto y empresa', 'Nuevo: necesidad del grupo', 'Crear', null, 1, 'TI, Dirección', '{"empresas": "Todas (una sola matriz para el grupo)", "para_que": "Que cada OC, pago, nómina o estimación la autorice la persona correcta según monto y empresa, sin depender de mensajes.", "pestanas": "Reglas · Autorizadores · Historial", "datos": "Tipo de documento (OC, OS, pago, nómina, estimación, préstamo entre empresas), empresa, rango de monto, autorizador principal y suplente, número de firmas.", "reglas": "Si no hay regla, el documento no avanza. Un usuario no autoriza lo que él mismo capturó. Cada autorización queda en la bitácora.", "conecta": "Autorizar órdenes, Programación de pagos, Nómina, Contratos y estimaciones, Bitácora de cambios", "quien": "Dirección (define montos) · TI (configura)"}'::jsonb),
  (99, 'Administración', 'Configuración', 'Bitácora de cambios', 'Quién cambió qué y cuándo', 'Match 17.c', 'Crear', null, 2, 'TI, Dirección', null),
  (100, 'Administración', 'Configuración', 'Guía de uso', 'Qué hace cada módulo y cuándo usarlo', 'Fuera: Guía de uso', 'Existe', '/guia', 1, 'Todos', null)

  ) as v (numero, grupo_menu, menu, opcion, que_hace, viene_de, estatus, ruta, fase, quien, especificacion)
 where g.codigo = 'LOMA'
on conflict (grupo_id, numero) do nothing;
