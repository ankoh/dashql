-- @description
-- Revenue per region and channel with the subtotals of every combination using `cube`.
-- `grouping` tells the subtotal rows apart, it is 1 for a column that is summed up.
-- @end

with orders(region, channel, amount) as (
    values ('EMEA', 'Web', 120.00), ('EMEA', 'Store', 80.00), ('EMEA', 'Web', 45.00),
           ('AMER', 'Web', 310.00), ('AMER', 'Store', 99.00), ('APAC', 'Web', 150.00)
)
select
    case when grouping(region) = 1 then 'All regions' else region end as region,
    case when grouping(channel) = 1 then 'All channels' else channel end as channel,
    sum(amount) as revenue
from orders
group by cube (region, channel)
order by grouping(region), region, grouping(channel), channel;
