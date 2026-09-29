-- A rate that has priced a receipt cannot be deleted.
--
-- Rates price on-the-spot receipts: post_collection() looks one up by fee type, class and
-- business date (migration 0043) and copies its amount into collection_lines.unit_rate.
-- Deleting such a rate changes no money, but it erases the ordinance behind amounts already
-- receipted, and a tablet that priced receipts with it offline has them refused as
-- rate_not_found when it next syncs. The way to stop a rate is to end-date it
-- (effective_to) and add the next one; rates_no_overlap keeps the two from colliding.
--
-- A rate never used is still deletable: that is the mistyped rate caught before anyone
-- collected under it. Cancelled receipts count as use: they were priced by the rate too.
--
-- Raised as 23503, the code a foreign key raises, so the web app's Delete shows the rate
-- resource's "in use" message rather than raw text. SECURITY DEFINER so the check sees
-- every receipt whatever the deleting role may read.

create or replace function ceedo_collections.assert_rate_unused()
returns trigger
language plpgsql
security definer
set search_path = ceedo_collections, pg_temp
as $$
begin
  if exists (
    select 1
      from ceedo_collections.collection_lines cl
      join ceedo_collections.collections c on c.id = cl.collection_id
     where cl.fee_type_id = old.fee_type_id
       and cl.rate_class = old.rate_class
       and c.business_date >= old.effective_from
       and (old.effective_to is null or c.business_date <= old.effective_to)
  ) then
    raise exception 'This rate has priced receipts, so it cannot be deleted. Set an effective-to date instead.'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

revoke execute on function ceedo_collections.assert_rate_unused() from public;

create trigger rates_delete_only_unused
  before delete on ceedo_collections.rates
  for each row execute function ceedo_collections.assert_rate_unused();
