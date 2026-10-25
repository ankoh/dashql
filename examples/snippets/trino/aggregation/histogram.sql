-- @dashql:description
-- Count the values of a measure in equally wide buckets.
-- Values below the range land in bucket 0, values above it in bucket 6.
-- @dashql:end

with requests(latency_ms) as (
    values (12), (18), (25), (40), (55), (61), (75), (140), (300)
)
select
    width_bucket(latency_ms, 0, 100, 5) as bucket,
    min(latency_ms) as min_ms,
    max(latency_ms) as max_ms,
    count(*) as requests
from requests
group by bucket
order by bucket;
