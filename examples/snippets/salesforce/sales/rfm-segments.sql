-- @description
-- Score customers by recency, frequency and monetary value and segment them.
-- @end

with orders(customer_id, ordered_at, amount) as (
    values ('C-1', timestamp '2026-03-20 10:00:00', 120.00), ('C-1', timestamp '2026-03-01 10:00:00', 90.00),
           ('C-1', timestamp '2026-02-10 10:00:00', 60.00), ('C-2', timestamp '2025-11-02 10:00:00', 40.00),
           ('C-3', timestamp '2026-03-25 10:00:00', 35.00), ('C-4', timestamp '2025-12-15 10:00:00', 400.00),
           ('C-4', timestamp '2025-10-01 10:00:00', 250.00), ('C-5', timestamp '2025-08-20 10:00:00', 15.00)
),
customers as (
    select
        customer_id,
        datediff('day', max(ordered_at), timestamp '2026-04-01 00:00:00') as days_since_last_order,
        count(*) as orders,
        sum(amount) as revenue
    from orders
    group by customer_id
),
scores as (
    select
        customer_id,
        days_since_last_order,
        orders,
        revenue,
        ntile(3) over (order by days_since_last_order desc) as recency,
        ntile(3) over (order by orders) as frequency,
        ntile(3) over (order by revenue) as monetary
    from customers
)
select
    customer_id,
    days_since_last_order,
    orders,
    revenue,
    case
        when recency = 3 and frequency = 3 then 'Champion'
        when recency = 3 then 'Recent'
        when monetary = 3 then 'Big Spender at Risk'
        else 'Hibernating'
    end as segment
from scores
order by customer_id;
