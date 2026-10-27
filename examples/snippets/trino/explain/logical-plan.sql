-- @description
-- Show the logical plan of a query before it is split into distributed fragments.
-- @end

explain (type logical)
with orders(customer, amount) as (
    values ('ada', 120), ('alan', 80), ('ada', 200)
)
select customer, sum(amount) as revenue
from orders
group by customer;
