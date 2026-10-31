/**
 * @description
 * Estimate the number of distinct values, much cheaper than an exact count on large tables.
 */

select
    approx_count_distinct(visitor_id) as approx_visitors,
    count(distinct visitor_id) as exact_visitors
from (
    select i % 25000 as visitor_id
    from generate_series(1, 100000) as visits(i)
) visits;
