-- @description
-- Compute the median and the 90th percentile of a measure per group.
-- @end

with requests(endpoint, latency_ms) as (
    values ('/home', 12), ('/home', 18), ('/home', 25), ('/home', 140),
           ('/search', 40), ('/search', 55), ('/search', 300)
)
select
    endpoint,
    approx_percentile(latency_ms, 0.5) as median_ms,
    approx_percentile(latency_ms, 0.9) as p90_ms
from requests
group by endpoint
order by endpoint;
