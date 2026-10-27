-- @description
-- Keep the rows whose timestamp lies within the last 30 days.
-- Compare against a moving bound, the result changes over time.
-- @end

with events(occurred_at, name) as (
    values
        (now() - interval '3' day, 'signup'),
        (now() - interval '12' day, 'purchase'),
        (now() - interval '45' day, 'signup'),
        (now() - interval '90' day, 'purchase')
)
select *
from events
where occurred_at >= now() - interval '30' day
order by occurred_at desc;
