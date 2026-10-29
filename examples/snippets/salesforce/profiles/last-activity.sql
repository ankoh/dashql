-- @description
-- The latest activity of each individual over all channels with `greatest`, which skips the nulls,
-- and the best way to reach them with `coalesce`, which takes the first value that is not null.
-- @end

with individuals(individual_id, mobile, phone, email, last_email_open, last_web_visit, last_purchase) as (
    values ('I-1', null, '+1 555 0100', 'ada@example.com',
            timestamp '2026-03-01 09:00:00', timestamp '2026-03-05 18:00:00', null),
           ('I-2', '+1 555 0199', null, '', null, null, timestamp '2026-02-11 10:00:00'),
           ('I-3', null, null, 'grace@example.com', timestamp '2026-01-20 08:00:00', null, null)
)
select
    individual_id,
    greatest(last_email_open, last_web_visit, last_purchase) as last_activity,
    coalesce(mobile, phone, nullif(email, '')) as best_contact
from individuals
order by individual_id;
