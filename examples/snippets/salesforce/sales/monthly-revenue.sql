/**
 * @description
 * Orders, revenue and the average order value per month.
 */

with orders(order_id, ordered_at, amount) as (
    values ('O-1', timestamp '2026-01-05 10:00:00', 120.00), ('O-2', timestamp '2026-01-19 16:20:00', 80.50),
           ('O-3', timestamp '2026-02-02 09:10:00', 45.00), ('O-4', timestamp '2026-02-14 12:00:00', 310.00),
           ('O-5', timestamp '2026-02-27 18:45:00', 99.90), ('O-6', timestamp '2026-03-08 11:30:00', 150.00)
)
select
    date_trunc('month', ordered_at) as month,
    count(*) as orders,
    sum(amount) as revenue,
    round(avg(amount), 2) as avg_order_value
from orders
group by date_trunc('month', ordered_at)
order by month;
