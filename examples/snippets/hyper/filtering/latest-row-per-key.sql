-- @description
-- Deduplicate a change log by keeping only the newest version of every key.
-- @end

with customer_versions(customer_id, email, updated_at) as (
    values
        (1, 'ada@old.example', timestamp '2026-01-01 08:00:00'),
        (1, 'ada@new.example', timestamp '2026-02-01 08:00:00'),
        (2, 'alan@example.com', timestamp '2026-01-15 08:00:00')
)
select customer_id, email, updated_at
from (
    select
        customer_versions.*,
        row_number() over (partition by customer_id order by updated_at desc) as version
    from customer_versions
) versions
where version = 1
order by customer_id;
