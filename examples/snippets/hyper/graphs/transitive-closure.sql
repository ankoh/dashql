-- @dashql:description
-- Expand a taxonomy into all ancestors of every class with a recursive query.
-- Graph patterns need an upper bound, a recursive query follows paths of any length.
-- @dashql:end

with recursive
    subclass_of(class, parent) as (
        values ('cat', 'mammal'), ('dog', 'mammal'), ('mammal', 'animal'),
               ('sparrow', 'bird'), ('bird', 'animal'), ('animal', 'organism')
    ),
    ancestors(class, ancestor, depth) as (
        select class, parent, 1
        from subclass_of
        union all
        select a.class, s.parent, a.depth + 1
        from ancestors a
        join subclass_of s on s.class = a.ancestor
    )
select class, ancestor, depth
from ancestors
order by class, depth;
