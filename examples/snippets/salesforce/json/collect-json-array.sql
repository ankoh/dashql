-- @description
-- Collect the products of each order into a JSON array with the aggregate `json_arrayagg`.
-- @end

with order_items(order_id, product, quantity) as (
    values ('O-1', 'Mouse', 1), ('O-1', 'Laptop', 1), ('O-1', 'Sleeve', 2),
           ('O-2', 'Keyboard', 1), ('O-2', 'Monitor', 2)
)
select
    order_id,
    json_arrayagg(product order by product) as products,
    sum(quantity) as items
from order_items
group by order_id
order by order_id;
