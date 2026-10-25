-- @dashql:description
-- Compare every row with the one before it using lag.
-- @dashql:end

with revenue(month, amount) as (
    values (date '2026-01-01', 1000.0), (date '2026-02-01', 1200.0), (date '2026-03-01', 900.0)
)
select
    month,
    amount,
    amount - lag(amount) over (order by month) as change,
    amount / lag(amount) over (order by month) - 1 as growth
from revenue
order by month;
