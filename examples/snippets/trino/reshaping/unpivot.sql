-- @description
-- Turn columns into rows, one row per quarter instead of one column per quarter.
-- @end

with revenue(product, q1, q2, q3, q4) as (
    values ('books', 120, 150, 90, 200), ('games', 80, 60, 110, 140)
)
select r.product, q.quarter, q.amount
from revenue r
cross join unnest(
    array['Q1', 'Q2', 'Q3', 'Q4'],
    array[r.q1, r.q2, r.q3, r.q4]
) as q(quarter, amount)
order by r.product, q.quarter;
