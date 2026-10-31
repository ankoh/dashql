/**
 * @description
 * Concatenate the products of each order into one sorted, comma-separated text with `listagg`.
 */

with order_items(order_id, product) as (
    values ('O-1', 'Mouse'), ('O-1', 'Laptop'), ('O-1', 'Sleeve'),
           ('O-2', 'Keyboard'), ('O-2', 'Monitor')
)
select
    order_id,
    listagg(product, ', ') within group (order by product) as products
from order_items
group by order_id
order by order_id;
