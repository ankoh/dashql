/**
 * @description
 * Show how every result column is computed from the columns of a pre-aggregation.
 * The average becomes a sum and a count that are divided after the aggregation.
 */

explain (format schema, postaggregation, sql_dialect internal_spark_2025_12)
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue, avg(amount) as average
from orders
group by customer;
