/**
 * @description
 * Check conditions over all rows of a group with `bool_and` and `bool_or`.
 */

with orders(customer_id, order_id, shipped, returned) as (
    values ('C-1', 'O-1', true, false), ('C-1', 'O-2', true, true),
           ('C-2', 'O-3', true, false), ('C-3', 'O-4', false, false), ('C-3', 'O-5', true, false)
)
select
    customer_id,
    count(*) as orders,
    bool_and(shipped) as all_shipped,
    bool_or(returned) as any_returned
from orders
group by customer_id
order by customer_id;
