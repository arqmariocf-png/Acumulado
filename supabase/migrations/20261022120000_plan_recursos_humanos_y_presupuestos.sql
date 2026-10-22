-- Plan del sistema (22-oct-2026, Mario: "la parte de nómina es realmente
-- recursos humanos"): el grupo "Nómina y mano de obra" se llama "Recursos
-- humanos" y el menú Recursos humanos (antes en Administración) pasa a ese
-- grupo, igual que en lib/menu.ts. "Presupuesto por obra" y "Presupuesto
-- contra real" quedan hechos con Avance financiero de obras.
--
-- Ya aplicado en producción.

update public.plan_sistema set grupo_menu = 'Recursos humanos', updated_at = now()
 where grupo_menu = 'Nómina y mano de obra' or (grupo_menu = 'Administración' and menu = 'Recursos humanos');

update public.plan_sistema set estatus = 'Hecho', ruta = '/finanzas/avance-financiero', avance = 100, updated_at = now()
 where menu = 'Presupuestos' and opcion in ('Presupuesto por obra', 'Presupuesto contra real') and estatus <> 'Hecho';
