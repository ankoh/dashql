-- @dashql:description
-- Group timestamps into 15-minute buckets.
-- @dashql:end

with events(happened_at) as (
    values (timestamp '2026-01-01 10:02:00'), (timestamp '2026-01-01 10:14:59'),
           (timestamp '2026-01-01 10:15:00'), (timestamp '2026-01-01 10:47:30'),
           (timestamp '2026-01-01 11:01:00')
)
select
    date_add('minute', minute(happened_at) / 15 * 15, date_trunc('hour', happened_at)) as bucket,
    count(*) as events
from events
group by 1
order by 1;
