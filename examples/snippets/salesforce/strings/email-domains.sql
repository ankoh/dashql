-- @description
-- Count the individuals per email domain with `split_part`, the fields count from 1.
-- @end

with emails(individual_id, email) as (
    values ('I-1', 'ada@example.com'), ('I-2', 'alan@Example.com'), ('I-3', 'grace@navy.mil'),
           ('I-4', 'edsger@utexas.edu'), ('I-5', 'barbara@example.com'), ('I-6', 'not-an-email')
)
select
    lower(split_part(email, '@', 2)) as domain,
    count(*) as individuals
from emails
where email like '%@%'
group by lower(split_part(email, '@', 2))
order by individuals desc, domain;
