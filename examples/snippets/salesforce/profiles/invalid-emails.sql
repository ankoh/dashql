/**
 * @description
 * Email addresses that do not look like `name@domain.tld`, e.g. typos or placeholders of a source system.
 */

with emails(individual_id, email) as (
    values ('I-1', 'ada@example.com'), ('I-2', 'alan@example'), ('I-3', 'grace.example.com'),
           ('I-4', 'n/a'), ('I-5', 'edsger@example.nl'), ('I-6', 'barbara@@example.com')
)
select
    individual_id,
    email
from emails
where not regexp_like(email, '^[^@ ]+@[^@ ]+\.[a-zA-Z]{2,}$')
order by individual_id;
