-- @description
-- Compare the unified profiles with the source records that identity resolution merged into them.
-- @end

with unified_individuals(unified_id, first_name, last_name) as (
    values ('U-1', 'Ada', 'Lovelace'), ('U-2', 'Alan', 'Turing')
),
identity_links(source_record_id, unified_id, data_source) as (
    values ('crm-1', 'U-1', 'CRM'), ('web-7', 'U-1', 'Web'), ('shop-3', 'U-1', 'Commerce'),
           ('crm-2', 'U-2', 'CRM'), ('web-9', 'U-2', 'Web')
),
individuals(source_record_id, first_name, last_name) as (
    values ('crm-1', 'Ada', 'Lovelace'), ('web-7', 'A.', 'Lovelace'), ('shop-3', 'Ada', 'King'),
           ('crm-2', 'Alan', 'Turing'), ('web-9', 'Alan M.', 'Turing')
)
select
    u.unified_id,
    u.first_name as unified_first_name,
    u.last_name as unified_last_name,
    l.data_source,
    i.first_name as source_first_name,
    i.last_name as source_last_name
from unified_individuals u
join identity_links l on l.unified_id = u.unified_id
join individuals i on i.source_record_id = l.source_record_id
order by u.unified_id, l.data_source;
