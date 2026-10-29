-- @description
-- Strip everything but digits from phone numbers with `regexp_replace` and the `g` flag for all matches.
-- @end

with phones(individual_id, phone) as (
    values ('I-1', '+1 (555) 010-0100'), ('I-2', '555.010.0199'), ('I-3', '555 0100 ext. 12'), ('I-4', '0049 89 123456')
)
select
    individual_id,
    phone,
    regexp_replace(phone, '[^0-9]', '', 'g') as digits,
    right(regexp_replace(phone, '[^0-9]', '', 'g'), 7) as last_seven_digits
from phones
order by individual_id;
