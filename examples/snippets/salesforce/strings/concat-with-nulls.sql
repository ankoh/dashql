-- @description
-- Build display names from optional parts: `||` returns null if one part is null, `concat` skips the nulls.
-- @end

with individuals(individual_id, salutation, first_name, middle_name, last_name) as (
    values ('I-1', 'Dr.', 'Grace', 'Brewster', 'Hopper'), ('I-2', null, 'Alan', 'Mathison', 'Turing'),
           ('I-3', 'Ms.', 'Ada', null, 'Lovelace')
)
select
    individual_id,
    salutation || ' ' || first_name || ' ' || last_name as with_operator,
    concat(salutation || ' ', first_name, ' ' || middle_name, ' ', last_name) as with_concat
from individuals
order by individual_id;
