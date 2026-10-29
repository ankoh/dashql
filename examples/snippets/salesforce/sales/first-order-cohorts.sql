-- @description
-- Group customers by the month of their first order and count how many of them order again in the following months.
-- @end

with orders(customer_id, ordered_at) as (
    values ('C-1', timestamp '2026-01-03 10:00:00'), ('C-1', timestamp '2026-02-20 10:00:00'),
           ('C-1', timestamp '2026-03-25 10:00:00'), ('C-2', timestamp '2026-01-10 10:00:00'),
           ('C-3', timestamp '2026-02-01 10:00:00'), ('C-3', timestamp '2026-03-02 10:00:00'),
           ('C-4', timestamp '2026-02-11 10:00:00')
),
monthly as (
    select
        customer_id,
        date_trunc('month', ordered_at) as order_month,
        min(date_trunc('month', ordered_at)) over (partition by customer_id) as cohort_month
    from orders
)
select
    cohort_month,
    datediff('month', cohort_month, order_month) as months_since_first_order,
    count(distinct customer_id) as customers
from monthly
group by cohort_month, datediff('month', cohort_month, order_month)
order by cohort_month, months_since_first_order;
