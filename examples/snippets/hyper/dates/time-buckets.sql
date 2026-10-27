-- @description
-- Group timestamps into 15-minute buckets.
-- @end

with events(happened_at) as (
    values (timestamp '2026-01-01 10:02:00'), (timestamp '2026-01-01 10:14:59'),
           (timestamp '2026-01-01 10:15:00'), (timestamp '2026-01-01 10:47:30'),
           (timestamp '2026-01-01 11:01:00')
)
select
    date_trunc('hour', happened_at)
        + interval '15' minute * floor(extract(minute from happened_at) / 15) as bucket,
    count(*) as events
from events
group by bucket
order by bucket;
