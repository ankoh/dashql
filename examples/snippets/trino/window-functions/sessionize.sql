/**
 * @description
 * Split a click stream into sessions that end after 30 minutes without a click.
 * A running sum over the session starts numbers the sessions.
 */

with clicks(user_name, clicked_at) as (
    values
        ('ada', timestamp '2026-01-01 10:00:00'),
        ('ada', timestamp '2026-01-01 10:12:00'),
        ('ada', timestamp '2026-01-01 11:30:00'),
        ('ada', timestamp '2026-01-01 11:41:00'),
        ('alan', timestamp '2026-01-01 10:05:00')
)
select
    user_name,
    clicked_at,
    sum(starts_session) over (partition by user_name order by clicked_at) as session
from (
    select
        user_name,
        clicked_at,
        case
            when clicked_at - lag(clicked_at) over (partition by user_name order by clicked_at)
                <= interval '30' minute then 0
            else 1
        end as starts_session
    from clicks
) flagged
order by user_name, clicked_at;
