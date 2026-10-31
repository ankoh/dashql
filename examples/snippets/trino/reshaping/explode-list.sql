/**
 * @description
 * Turn the elements of a list into rows, with their position in the list.
 */

with posts(post_id, tags) as (
    values (1, array['sql', 'graphs', 'trino']), (2, array['json'])
)
select p.post_id, t.tag, t.position
from posts p
cross join unnest(p.tags) with ordinality as t(tag, position)
order by p.post_id, t.position;
