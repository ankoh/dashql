-- @dashql:description
-- Show the optimized plan of a query as an operator tree without running it.
-- @dashql:end

explain
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue
from orders
group by customer;
