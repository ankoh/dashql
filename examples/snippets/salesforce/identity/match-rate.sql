-- @description
-- How many source records identity resolution merged into how many unified profiles, per data source.
-- @end

with identity_links(source_record_id, unified_id, data_source) as (
    values ('crm-1', 'U-1', 'CRM'), ('web-7', 'U-1', 'Web'), ('shop-3', 'U-1', 'Commerce'),
           ('crm-2', 'U-2', 'CRM'), ('web-9', 'U-2', 'Web'),
           ('crm-3', 'U-3', 'CRM'), ('shop-5', 'U-4', 'Commerce')
)
select
    data_source,
    count(distinct source_record_id) as source_records,
    count(distinct unified_id) as unified_profiles
from identity_links
group by rollup (data_source)
order by data_source nulls last;
