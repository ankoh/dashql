/**
 * @description
 * Pick the value of one column at the row where another column is largest or smallest.
 * max_by and min_by replace a self-join or a window function.
 */

with status_changes(order_id, status, changed_at) as (
    values
        (1, 'placed', timestamp '2026-01-01 09:00:00'),
        (1, 'shipped', timestamp '2026-01-02 14:00:00'),
        (1, 'delivered', timestamp '2026-01-04 11:30:00'),
        (2, 'placed', timestamp '2026-01-03 10:00:00'),
        (2, 'cancelled', timestamp '2026-01-03 10:05:00')
)
select
    order_id,
    min_by(status, changed_at) as first_status,
    max_by(status, changed_at) as current_status,
    max(changed_at) as updated_at
from status_changes
group by order_id
order by order_id;
