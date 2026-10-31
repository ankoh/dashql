/**
 * @description
 * Count the orders in equally wide value buckets with `width_bucket`.
 * Values below the range land in bucket 0, values above it in bucket 6.
 */

with orders(order_id, amount) as (
    values ('O-1', 12.00), ('O-2', 18.50), ('O-3', 25.00), ('O-4', 40.00), ('O-5', 55.00),
           ('O-6', 61.00), ('O-7', 75.00), ('O-8', 140.00), ('O-9', 300.00)
)
select
    width_bucket(amount, 0, 100, 5) as bucket,
    min(amount) as min_amount,
    max(amount) as max_amount,
    count(*) as orders
from orders
group by bucket
order by bucket;
