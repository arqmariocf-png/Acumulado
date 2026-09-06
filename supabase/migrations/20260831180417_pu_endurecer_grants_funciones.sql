-- Los helpers de permiso son SECURITY DEFINER porque las políticas RLS los
-- invocan con el rol del usuario. Eso los deja expuestos como RPC, así que se
-- limita quién puede llamarlos: authenticated sí (lo necesita para que RLS
-- evalúe), anon no tiene nada que hacer en el módulo de precios unitarios.

revoke execute on function auth_puede_escribir_pu() from anon;
revoke execute on function auth_es_supervisor_pu(uuid) from anon;
revoke execute on function auth_participa_pu(uuid, uuid) from anon;
revoke execute on function auth_edita_borrador_pu(uuid) from anon;
revoke execute on function auth_revisa_material_pu(uuid) from anon;

-- Funciones de trigger: nadie las llama directo, y por RPC sólo podrían
-- fallar. Se sacan de la superficie de la API.
revoke execute on function registrar_aprobacion_pu() from anon, authenticated;
revoke execute on function validar_flujo_pu_analisis() from anon, authenticated;
revoke execute on function validar_ciclo_pu_analisis() from anon, authenticated;
revoke execute on function validar_empresa_pu_analisis() from anon, authenticated;
revoke execute on function restringir_edicion_almacen_pu() from anon, authenticated;