-- @description
-- Filter rows with like patterns, case-insensitively.
-- In a pattern, % matches any sequence of characters, _ a single one.
-- @end

with products(name) as (
    values ('Dark Roast Coffee'), ('Green Tea'), ('Iced coffee'), ('Hot Chocolate')
)
select name
from products
where lower(name) like '%coffee%'
order by name;
