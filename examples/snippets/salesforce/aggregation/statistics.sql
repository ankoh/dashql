-- @description
-- Describe two measures with their spread and how strongly they move together.
-- `percentile_disc` returns an actual input value, `percentile_cont` interpolates.
-- @end

with customers(customer_id, web_visits, revenue) as (
    values ('C-1', 3, 40.00), ('C-2', 8, 120.00), ('C-3', 12, 180.00), ('C-4', 5, 75.00),
           ('C-5', 20, 260.00), ('C-6', 1, 15.00), ('C-7', 9, 90.00)
)
select
    avg(revenue) as avg_revenue,
    stddev_samp(revenue) as stddev_revenue,
    percentile_disc(0.5) within group (order by revenue) as median_revenue,
    percentile_cont(0.5) within group (order by revenue) as interpolated_median_revenue,
    corr(web_visits, revenue) as visits_revenue_correlation
from customers;
