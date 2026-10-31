/**
 * @description
 * Check that a query is valid without planning or running it.
 */

explain (type validate)
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue
from orders
group by customer;
