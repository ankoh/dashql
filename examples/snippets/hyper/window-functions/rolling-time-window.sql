-- @description
-- Sum a measure over the last seven days of every row, even when days are missing.
-- A range frame counts in days, a rows frame would count in rows.
-- @end

with sales(day, revenue) as (
    values (date '2026-01-01', 100), (date '2026-01-02', 80), (date '2026-01-05', 120),
           (date '2026-01-09', 60), (date '2026-01-10', 90), (date '2026-01-20', 40)
)
select
    day,
    revenue,
    sum(revenue) over (order by day range between interval '6' day preceding and current row) as revenue_7d
from sales
order by day;
