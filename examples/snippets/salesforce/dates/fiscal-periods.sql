/**
 * @description
 * Truncate dates to the fiscal month, quarter and year of the fiscal calendar configured in the org.
 */

with orders(order_id, ordered_on) as (
    values ('O-1', date '2026-01-15'), ('O-2', date '2026-02-03'), ('O-3', date '2026-04-28'),
           ('O-4', date '2026-07-01'), ('O-5', date '2026-11-30')
)
select
    order_id,
    ordered_on,
    date_trunc('fiscal_month', ordered_on) as fiscal_month,
    date_trunc('fiscal_quarter', ordered_on) as fiscal_quarter,
    date_trunc('fiscal_year', ordered_on) as fiscal_year
from orders
order by ordered_on;
