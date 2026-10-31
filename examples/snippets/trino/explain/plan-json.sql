/**
 * @description
 * Show the distributed plan of a query as JSON.
 */

explain (format json)
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue
from orders
group by customer;
