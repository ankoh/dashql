/**
 * @description
 * Normalize names from different sources: trim, collapse inner spaces and capitalize every word with `initcap`.
 */

with individuals(individual_id, first_name, last_name) as (
    values ('I-1', '  ada ', 'LOVELACE'), ('I-2', 'alan  mathison', 'turing'),
           ('I-3', 'GRACE', 'hopper'), ('I-4', 'mary-jane', 'o''brien')
)
select
    individual_id,
    initcap(regexp_replace(trim(first_name), ' +', ' ', 'g')) as first_name,
    initcap(trim(last_name)) as last_name,
    left(initcap(trim(first_name)), 1) || '. ' || initcap(trim(last_name)) as short_name
from individuals
order by individual_id;
