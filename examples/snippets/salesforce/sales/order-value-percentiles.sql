/**
 * @description
 * The spread of the order values with exact percentiles and an approximate customer count.
 */

with orders(customer_id, amount) as (
    values ('C-1', 12.00), ('C-2', 18.50), ('C-1', 25.00), ('C-3', 40.00), ('C-4', 55.00),
           ('C-2', 61.00), ('C-5', 75.00), ('C-3', 140.00), ('C-6', 300.00)
)
select
    count(*) as orders,
    approx_count_distinct(customer_id) as approx_customers,
    min(amount) as min_value,
    percentile_cont(0.25) within group (order by amount) as p25,
    percentile_cont(0.5) within group (order by amount) as median,
    percentile_cont(0.9) within group (order by amount) as p90,
    max(amount) as max_value
from orders;
