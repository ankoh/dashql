explain (FORMAT SCHEMA, PREAGGREGATION)
with d as (
    select (random() * 100)::integer as key, random() as value
    from generate_series(1, 1000) t(x)
)
select key, sum(value), rank() over (partition by key)
from d
group by key;