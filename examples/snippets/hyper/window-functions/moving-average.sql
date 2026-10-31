/**
 * @description
 * Smooth a time series with the average over a sliding window of rows.
 * The window holds the current row and the two before it.
 */

with visits(day, visitors) as (
    values (date '2026-01-01', 120), (date '2026-01-02', 90), (date '2026-01-03', 150),
           (date '2026-01-04', 60), (date '2026-01-05', 130), (date '2026-01-06', 110)
)
select
    day,
    visitors,
    avg(visitors) over (order by day rows between 2 preceding and current row) as visitors_3d_avg
from visits
order by day;
