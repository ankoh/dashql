-- @description
-- Select individuals by the values of an array column with `array_contains` and `array_contains_any`.
-- The comparison of texts is case-sensitive.
-- @end

with individuals(individual_id, interests) as (
    values ('I-1', array['Hiking', 'Running']), ('I-2', array['Cooking']),
           ('I-3', array['Cycling', 'Hiking']), ('I-4', array['Reading', 'Running'])
)
select
    individual_id,
    interests,
    array_contains(interests, 'Hiking') as likes_hiking,
    array_contains_any(interests, array['Running', 'Cycling']) as endurance_sports
from individuals
order by individual_id;
