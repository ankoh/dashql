/**
 * @description
 * The days between two orders of the same customer.
 */

with orders(customer_id, ordered_at) as (
    values ('C-1', timestamp '2026-01-03 10:00:00'), ('C-1', timestamp '2026-01-20 10:00:00'),
           ('C-1', timestamp '2026-02-25 10:00:00'), ('C-2', timestamp '2026-01-10 10:00:00'),
           ('C-2', timestamp '2026-03-12 10:00:00'), ('C-3', timestamp '2026-02-01 10:00:00')
)
select
    customer_id,
    ordered_at,
    datediff('day', lag(ordered_at) over (partition by customer_id order by ordered_at), ordered_at) as days_since_previous_order
from orders
order by customer_id, ordered_at;
