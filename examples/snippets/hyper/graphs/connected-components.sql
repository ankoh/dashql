-- @dashql:description
-- Group the nodes of an undirected graph into connected components.
-- Every node is labeled with the smallest node it can reach, union stops the recursion on cycles.
-- @dashql:end

with recursive
    links(a, b) as (
        values (1, 2), (2, 3), (3, 1), (4, 5), (6, 6)
    ),
    edges(a, b) as (
        select a, b from links
        union
        select b, a from links
    ),
    reachable(node, reached) as (
        select a, b from edges
        union
        select r.node, e.b
        from reachable r
        join edges e on e.a = r.reached
    )
select node, least(node, min(reached)) as component
from reachable
group by node
order by component, node;
