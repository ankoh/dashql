/**
 * @description
 * The first and the last marketing touch before each conversion, for first- and last-touch attribution.
 * `first_value` and `last_value` read the window frame, which ends at the current row unless it spans the partition.
 */

with touches(customer_id, touched_at, channel) as (
    values ('C-1', timestamp '2026-03-01 09:00:00', 'Paid Search'), ('C-1', timestamp '2026-03-04 12:00:00', 'Email'),
           ('C-1', timestamp '2026-03-06 18:00:00', 'Social'), ('C-2', timestamp '2026-03-02 10:00:00', 'Email'),
           ('C-2', timestamp '2026-03-09 08:30:00', 'Direct')
)
select distinct
    customer_id,
    first_value(channel) over customer_touches as first_touch,
    last_value(channel) over customer_touches as last_touch,
    count(*) over customer_touches as touches
from touches
window customer_touches as (
    partition by customer_id
    order by touched_at
    rows between unbounded preceding and unbounded following
)
order by customer_id;
