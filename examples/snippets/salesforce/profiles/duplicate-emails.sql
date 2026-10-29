-- @description
-- Email addresses shared by several individuals, ignoring case and surrounding spaces.
-- Candidates for the match rules of identity resolution.
-- @end

with emails(individual_id, email) as (
    values ('I-1', 'ada@example.com'), ('I-2', ' Ada@Example.com'), ('I-3', 'grace@example.com'),
           ('I-4', 'ADA@example.com '), ('I-5', 'grace@example.com'), ('I-6', 'alan@example.com')
)
select
    lower(trim(email)) as normalized_email,
    count(distinct individual_id) as individuals,
    array_agg(individual_id order by individual_id) as individual_ids
from emails
group by lower(trim(email))
having count(distinct individual_id) > 1
order by individuals desc;
