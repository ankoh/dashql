/**
 * @description
 * Accumulate a measure over time with a cumulative window sum.
 */

with deposits(day, amount) as (
    values (date '2026-01-01', 100), (date '2026-01-02', 50),
           (date '2026-01-03', -30), (date '2026-01-04', 80)
)
select
    day,
    amount,
    sum(amount) over (order by day rows between unbounded preceding and current row) as balance
from deposits
order by day;
