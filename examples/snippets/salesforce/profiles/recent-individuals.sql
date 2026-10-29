-- @description
-- The newest individuals with their email addresses, also those without one.
-- @end

with individuals(individual_id, first_name, last_name, created_at) as (
    values ('I-1', 'Ada', 'Lovelace', timestamp '2026-03-01 09:00:00'),
           ('I-2', 'Alan', 'Turing', timestamp '2026-03-04 14:30:00'),
           ('I-3', 'Grace', 'Hopper', timestamp '2026-03-02 11:15:00'),
           ('I-4', 'Edsger', 'Dijkstra', timestamp '2026-03-05 08:45:00')
),
emails(individual_id, email) as (
    values ('I-1', 'ada@example.com'), ('I-2', 'alan@example.com'), ('I-4', 'edsger@example.com')
)
select
    i.individual_id,
    i.first_name,
    i.last_name,
    e.email,
    i.created_at
from individuals i
left join emails e on e.individual_id = i.individual_id
order by i.created_at desc
limit 3;
