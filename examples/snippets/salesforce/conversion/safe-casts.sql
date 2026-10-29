-- @description
-- Convert untyped text from a source system, casting only the values that match the expected format.
-- @end

with raw_orders(order_id, amount_text, ordered_text) as (
    values ('O-1', '120.50', '2026-03-01'), ('O-2', 'n/a', '2026-03-02'),
           ('O-3', '80', 'yesterday'), ('O-4', '1,000.00', '2026-03-04')
)
select
    order_id,
    case when regexp_like(amount_text, '^[0-9]+(\.[0-9]+)?$') then amount_text::decimal(10, 2) end as amount,
    case when regexp_like(ordered_text, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then ordered_text::date end as ordered_on
from raw_orders
order by order_id;
