-- @dashql:description
-- Find streaks of consecutive days.
-- Consecutive days minus their row number land on the same date, which identifies the streak.
-- @dashql:end

with logins(user_name, day) as (
    values ('ada', date '2026-01-01'), ('ada', date '2026-01-02'), ('ada', date '2026-01-03'),
           ('ada', date '2026-01-07'), ('ada', date '2026-01-08'), ('alan', date '2026-01-02')
)
select user_name, min(day) as first_day, max(day) as last_day, count(*) as days
from (
    select
        user_name,
        day,
        day - cast(row_number() over (partition by user_name order by day) as integer) as streak
    from logins
) days
group by user_name, streak
order by user_name, first_day;
