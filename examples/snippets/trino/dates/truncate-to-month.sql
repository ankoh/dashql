-- @description
-- Truncate timestamps to the first day of their month and aggregate per month.
-- Use 'week', 'quarter' or 'year' for other granularities.
-- @end

with orders(ordered_at, amount) as (
    values
        (timestamp '2026-01-05 10:00:00', 120.0),
        (timestamp '2026-01-28 16:30:00', 80.0),
        (timestamp '2026-02-02 09:15:00', 200.0),
        (timestamp '2026-03-17 12:00:00', 45.5)
)
select
    date_trunc('month', ordered_at) as month,
    count(*) as orders,
    sum(amount) as revenue
from orders
group by 1
order by 1;
