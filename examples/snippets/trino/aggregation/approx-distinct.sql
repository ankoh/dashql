-- @dashql:description
-- Estimate the number of distinct values, much cheaper than an exact count on large tables.
-- @dashql:end

select
    approx_distinct(visitor_id) as approx_visitors,
    count(distinct visitor_id) as exact_visitors
from (
    select i % 2500 as visitor_id
    from unnest(sequence(1, 10000)) as visits(i)
) visits;
