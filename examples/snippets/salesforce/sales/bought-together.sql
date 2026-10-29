-- @description
-- The product pairs that appear together in the most orders.
-- @end

with order_items(order_id, product) as (
    values ('O-1', 'Laptop'), ('O-1', 'Mouse'), ('O-1', 'Sleeve'),
           ('O-2', 'Laptop'), ('O-2', 'Mouse'),
           ('O-3', 'Mouse'), ('O-3', 'Keyboard'),
           ('O-4', 'Laptop'), ('O-4', 'Sleeve')
)
select
    a.product,
    b.product as bought_with,
    count(distinct a.order_id) as orders
from order_items a
join order_items b on b.order_id = a.order_id and b.product > a.product
group by a.product, b.product
order by orders desc, a.product, b.product;
