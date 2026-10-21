-- Quien está etiquetado en una tarjeta la ve aunque el tablero sea de otra
-- empresa (21-oct-2026, Mario: "etiqueté a Fernanda en una tarea en un
-- proyecto que ella no participa; al etiquetarla debería salirle como tarea
-- pendiente"; "cuando dan click a sus pendientes no los redirige a sus
-- tareas"). Maria Fernanda (responsable, MCF) estaba de responsable en "Subir
-- proyecto" del tablero de Abarrotes Neto Rio Frio (CSC): tableros_select solo
-- abre los de su empresa, así que la tarjeta no salía en Mis actividades y la
-- liga de sus misiones del día (fn_mi_personaje, definer) abría un tablero
-- vacío.
--
-- Ahora, además de lo de siempre, cada quien ve las tarjetas donde es
-- responsable, supervisor o corresponsable (solo esas, no las demás del
-- tablero), el tablero y sus columnas para abrirlas, y sus comentarios y
-- archivos; puede moverlas, comentar y subir archivos como cualquiera que ve
-- el tablero (lo "de fondo" lo sigue guardando tarjetas_guarda_fondo). Helpers
-- definer que regresan uuid[] y se llaman con (select …) una vez por consulta.
-- La frontera de organización sigue aplicando (restrictiva).
-- Ya aplicado en producción (tarjetas_ve_quien_esta_etiquetado).

create or replace function public.auth_tarjetas_etiquetado()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(k.id), '{}')
    from public.tarjetas k
   where (select public.auth_rol_definer()) <> 'pendiente'
     and auth.uid() is not null
     and (k.asignado_a = auth.uid() or k.supervisor_id = auth.uid() or auth.uid() = any (coalesce(k.corresponsables, '{}')));
$$;

create or replace function public.auth_tableros_etiquetado()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k.tablero_id), '{}')
    from public.tarjetas k
   where k.id = any (public.auth_tarjetas_etiquetado());
$$;

revoke all on function public.auth_tarjetas_etiquetado() from public, anon;
revoke all on function public.auth_tableros_etiquetado() from public, anon;
grant execute on function public.auth_tarjetas_etiquetado() to authenticated;
grant execute on function public.auth_tableros_etiquetado() to authenticated;

drop policy if exists tarjetas_etiquetado_select on public.tarjetas;
create policy tarjetas_etiquetado_select on public.tarjetas for select
  using (id = any ((select public.auth_tarjetas_etiquetado())::uuid[]));

drop policy if exists tarjetas_etiquetado_update on public.tarjetas;
create policy tarjetas_etiquetado_update on public.tarjetas for update
  using (id = any ((select public.auth_tarjetas_etiquetado())::uuid[]))
  with check (tablero_id = any ((select public.auth_tableros_etiquetado())::uuid[]));

drop policy if exists tableros_etiquetado_select on public.tableros;
create policy tableros_etiquetado_select on public.tableros for select
  using (id = any ((select public.auth_tableros_etiquetado())::uuid[]));

drop policy if exists tablero_columnas_etiquetado_select on public.tablero_columnas;
create policy tablero_columnas_etiquetado_select on public.tablero_columnas for select
  using (tablero_id = any ((select public.auth_tableros_etiquetado())::uuid[]));

drop policy if exists tarjeta_comentarios_etiquetado_select on public.tarjeta_comentarios;
create policy tarjeta_comentarios_etiquetado_select on public.tarjeta_comentarios for select
  using (tarjeta_id = any ((select public.auth_tarjetas_etiquetado())::uuid[]));

drop policy if exists tarjeta_comentarios_etiquetado_insert on public.tarjeta_comentarios;
create policy tarjeta_comentarios_etiquetado_insert on public.tarjeta_comentarios for insert
  with check (autor_id = (select auth.uid()) and tarjeta_id = any ((select public.auth_tarjetas_etiquetado())::uuid[]));

drop policy if exists tarjeta_archivos_etiquetado_select on public.tarjeta_archivos;
create policy tarjeta_archivos_etiquetado_select on public.tarjeta_archivos for select
  using (tarjeta_id = any ((select public.auth_tarjetas_etiquetado())::uuid[]));

drop policy if exists tarjeta_archivos_etiquetado_insert on public.tarjeta_archivos;
create policy tarjeta_archivos_etiquetado_insert on public.tarjeta_archivos for insert
  with check (subido_por = (select auth.uid()) and tarjeta_id = any ((select public.auth_tarjetas_etiquetado())::uuid[]));
