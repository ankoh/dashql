/**
 * @description
 * Clean up arrays: drop the nulls with `array_compact`, the duplicates with `array_distinct`, sort them and take
 * the first elements with a slice. Arrays count from 1, both bounds of a slice are inclusive.
 */

with carts(cart_id, products) as (
    values ('K-1', array['Mouse', null, 'Laptop', 'Mouse', 'Sleeve']),
           ('K-2', array['Keyboard', 'Keyboard', null])
)
select
    cart_id,
    products,
    array_sort(array_distinct(array_compact(products))) as clean_products,
    (array_sort(array_distinct(array_compact(products))))[1:2] as first_two,
    array_position(products, 'Mouse') as first_mouse_at,
    array_length(products) as entries
from carts
order by cart_id;
