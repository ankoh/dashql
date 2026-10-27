-- @description
-- Add subtotals and a grand total to a grouped result with rollup.
-- grouping() tells the total rows apart from groups whose key is null.
-- @end

with sales(region, country, revenue) as (
    values ('Europe', 'Germany', 420), ('Europe', 'France', 310),
           ('America', 'Canada', 150), ('America', 'Mexico', 90)
)
select
    case when grouping(region) = 1 then 'All regions' else region end as region,
    case when grouping(country) = 1 then 'All countries' else country end as country,
    sum(revenue) as revenue
from sales
group by rollup (region, country)
order by grouping(region), region, grouping(country), country;
