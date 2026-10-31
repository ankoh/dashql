/**
 * @description
 * Produce one row per day, e.g. to fill the gaps of a time series with a left join.
 */

select day
from unnest(sequence(date '2026-01-01', date '2026-01-14', interval '1' day)) as days(day)
order by day;
