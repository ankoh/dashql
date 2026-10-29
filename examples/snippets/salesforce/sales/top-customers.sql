-- @description
-- The customers with the highest revenue.
-- Joining on the key qualifier as well keeps equal ids of different data sources apart.
-- @end

with individuals(individual_id, key_qualifier, name) as (
    values ('C-1', 'CRM', 'Ada Lovelace'), ('C-1', 'Commerce', 'Alan Turing'), ('C-2', 'CRM', 'Grace Hopper')
),
orders(order_id, customer_id, customer_key_qualifier, amount) as (
    values ('O-1', 'C-1', 'CRM', 120.00), ('O-2', 'C-1', 'Commerce', 80.00), ('O-3', 'C-1', 'CRM', 45.00),
           ('O-4', 'C-2', 'CRM', 310.00), ('O-5', 'C-1', 'Commerce', 99.00)
)
select
    i.name,
    i.key_qualifier,
    count(*) as orders,
    sum(o.amount) as revenue
from orders o
join individuals i
    on i.individual_id = o.customer_id
    and i.key_qualifier is not distinct from o.customer_key_qualifier
group by i.name, i.key_qualifier
order by revenue desc;
