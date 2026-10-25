-- @dashql:description
-- Split an aggregation into a pre-aggregation that runs at the source and its stages.
-- @dashql:end

explain (format sql_stages, sql_dialect internal_spark_2025_12, preaggregation)
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue, avg(amount) as average
from orders
group by customer;
