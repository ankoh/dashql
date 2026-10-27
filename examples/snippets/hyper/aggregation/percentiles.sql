-- @description
-- Compute the median and the 90th percentile of a measure per group.
-- @end

with requests(endpoint, latency_ms) as (
    values ('/home', 12), ('/home', 18), ('/home', 25), ('/home', 140),
           ('/search', 40), ('/search', 55), ('/search', 300)
)
select
    endpoint,
    percentile_cont(0.5) within group (order by latency_ms) as median_ms,
    percentile_cont(0.9) within group (order by latency_ms) as p90_ms
from requests
group by endpoint
order by endpoint;
