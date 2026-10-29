-- @description
-- The hours until the next engagement of the same individual with `lead`.
-- @end

with engagements(individual_id, engaged_at, action) as (
    values ('I-1', timestamp '2026-03-01 09:00:00', 'Email Open'), ('I-1', timestamp '2026-03-01 09:05:00', 'Email Click'),
           ('I-1', timestamp '2026-03-02 20:00:00', 'Web Visit'), ('I-2', timestamp '2026-03-03 11:00:00', 'Email Open'),
           ('I-2', timestamp '2026-03-07 11:00:00', 'Purchase')
)
select
    individual_id,
    engaged_at,
    action,
    lead(action) over (partition by individual_id order by engaged_at) as next_action,
    datediff('hour', engaged_at, lead(engaged_at) over (partition by individual_id order by engaged_at)) as hours_to_next_action
from engagements
order by individual_id, engaged_at;
