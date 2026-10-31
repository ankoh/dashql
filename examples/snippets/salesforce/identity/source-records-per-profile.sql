/**
 * @description
 * The distribution of the number of source records per unified profile.
 * Profiles with very many source records hint at match rules that are too loose.
 */

with identity_links(source_record_id, unified_id) as (
    values ('crm-1', 'U-1'), ('web-7', 'U-1'), ('shop-3', 'U-1'), ('web-8', 'U-1'),
           ('crm-2', 'U-2'), ('web-9', 'U-2'),
           ('crm-3', 'U-3'), ('shop-5', 'U-4'), ('crm-4', 'U-5'), ('web-2', 'U-5')
),
profile_sizes as (
    select unified_id, count(*) as source_records
    from identity_links
    group by unified_id
)
select
    source_records,
    count(*) as unified_profiles
from profile_sizes
group by source_records
order by source_records;
