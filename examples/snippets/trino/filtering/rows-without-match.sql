-- @description
-- Find the rows of one table that have no matching row in another table (anti join).
-- @end

with customers(customer_id, name) as (
    values (1, 'Ada'), (2, 'Alan'), (3, 'Grace')
),
orders(order_id, customer_id) as (
    values (10, 1), (11, 1), (12, 3)
)
select c.*
from customers c
where not exists (
    select 1 from orders o where o.customer_id = c.customer_id
);
