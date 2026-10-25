-- @dashql:description
-- Run a query and annotate its plan with the actual row counts and the time spent per operator.
-- @dashql:end

explain (analyze)
select i % 10 as bucket, count(*) as numbers
from generate_series(1, 100000) as numbers(i)
group by bucket;
