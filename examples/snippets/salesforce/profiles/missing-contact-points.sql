/**
 * @description
 * Individuals that can be reached neither by email nor by phone.
 */

with individuals(individual_id, first_name, last_name) as (
    values ('I-1', 'Ada', 'Lovelace'), ('I-2', 'Alan', 'Turing'),
           ('I-3', 'Grace', 'Hopper'), ('I-4', 'Edsger', 'Dijkstra')
),
emails(individual_id, email) as (
    values ('I-1', 'ada@example.com')
),
phones(individual_id, phone) as (
    values ('I-2', '+1 555 0100')
)
select
    i.individual_id,
    i.first_name,
    i.last_name
from individuals i
where not exists (select 1 from emails e where e.individual_id = i.individual_id)
and not exists (select 1 from phones p where p.individual_id = i.individual_id)
order by i.individual_id;
