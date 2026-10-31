/**
 * @description
 * Translate a query into the SQL dialect of Spark.
 */

explain (format sql, sql_dialect internal_spark_2025_12)
with orders(customer, amount, ordered_at) as (
    values ('ada', 120, date '2026-01-05'), ('alan', 80, date '2026-02-11'), ('ada', 200, date '2026-02-20')
)
select
    upper(customer) as customer,
    date_trunc('month', ordered_at) as month,
    sum(amount) filter (where amount > 100) as large_orders
from orders
where customer like 'a%'
group by 1, 2;
