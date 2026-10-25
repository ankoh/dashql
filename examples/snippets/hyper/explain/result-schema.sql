-- @dashql:description
-- Get the names and types of the result columns of a query without running it.
-- @dashql:end

explain (format schema)
with orders(customer, amount, ordered_at) as (
    values ('ada', 120.50, date '2026-01-05')
)
select customer, sum(amount) as revenue, max(ordered_at) as last_order
from orders
group by customer;
