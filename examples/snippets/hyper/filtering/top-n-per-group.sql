-- @description
-- Keep the two best-selling products of every category with a ranking window function.
-- @end

with sales(category, product, revenue) as (
    values
        ('books', 'Dune', 420),
        ('books', 'Emma', 310),
        ('books', 'Ulysses', 150),
        ('games', 'Chess', 90),
        ('games', 'Go', 260),
        ('games', 'Catan', 510)
)
select category, product, revenue
from (
    select
        sales.*,
        row_number() over (partition by category order by revenue desc) as rank_in_category
    from sales
) ranked
where rank_in_category <= 2
order by category, rank_in_category;
