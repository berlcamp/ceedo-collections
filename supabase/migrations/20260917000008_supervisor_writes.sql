-- Spec 11.1: supervisors assign booklets, verify returns, and manage the tablets their
-- collectors use. apply_master_data_policies() is admin-only by design; RLS policies are
-- permissive and OR together, so this adds supervisors alongside admins on exactly these
-- five tables and changes nothing elsewhere.
do $$
declare
  t text;
begin
  foreach t in array array[
    'booklets', 'booklet_assignments', 'spoiled_forms', 'devices', 'device_assignments'
  ]
  loop
    execute format(
      'create policy %I on ceedo_collections.%I for all to authenticated
         using (ceedo_collections.has_role(''supervisor'', ''admin''))
         with check (ceedo_collections.has_role(''supervisor'', ''admin''))',
      t || '_supervisor_write', t);
  end loop;
end;
$$;
