-- @dashql:description
-- Turn columns into rows, one row per quarter instead of one column per quarter.
-- @dashql:end

with revenue(product, q1, q2, q3, q4) as (
    values ('books', 120, 150, 90, 200), ('games', 80, 60, 110, 140)
)
select r.product, q.quarter, q.amount
from revenue r
cross join lateral (
    values ('Q1', r.q1), ('Q2', r.q2), ('Q3', r.q3), ('Q4', r.q4)
) as q(quarter, amount)
order by r.product, q.quarter;
