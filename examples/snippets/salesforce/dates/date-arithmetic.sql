-- @description
-- Add to and subtract from timestamps and measure the distance between them.
-- There is no `date_sub`, `date_add` with a negative amount goes back in time.
-- @end

with subscriptions(subscription_id, started_at, ended_at) as (
    values ('S-1', timestamp '2025-01-15 09:00:00', timestamp '2026-01-14 09:00:00'),
           ('S-2', timestamp '2025-06-01 12:00:00', timestamp '2025-09-01 12:00:00'),
           ('S-3', timestamp '2026-02-28 08:30:00', timestamp '2026-03-01 08:30:00')
)
select
    subscription_id,
    datediff('day', started_at, ended_at) as days,
    datediff('month', started_at, ended_at) as months,
    date_add('year', 1, started_at) as renewal_at,
    date_add('day', -30, ended_at) as reminder_at
from subscriptions
order by subscription_id;
