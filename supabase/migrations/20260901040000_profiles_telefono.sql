-- Teléfono opcional por usuario, capturado por admin en Usuarios -- hace
-- posible mandar el link de acceso/recuperación por WhatsApp con un solo
-- clic en vez de copiar/pegar a mano (ver web/src/pages/admin/Usuarios.tsx).
-- No se saca de `personal` (RH) porque esa tabla es de empleados, no de
-- cuentas -- no todo usuario de `profiles` tiene ficha ahí (ej. Mario,
-- corporativo) ni todo empleado de `personal` tiene una cuenta.
alter table public.profiles
  add column telefono text;

comment on column public.profiles.telefono is 'Número de WhatsApp (con o sin código de país) para mandarle links de acceso directo sin depender del correo. Opcional.';
