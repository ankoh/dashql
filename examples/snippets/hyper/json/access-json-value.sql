-- @description
-- Read nested fields of a JSON document with the -> and ->> operators.
-- The operator -> returns json, ->> returns text.
-- @end

with events(payload) as (
    values
        ('{"user": {"id": 7, "name": "Ada"}, "tags": ["admin", "beta"]}'),
        ('{"user": {"id": 8, "name": "Alan"}, "tags": []}')
)
select
    cast(payload as json) -> 'user' ->> 'name' as user_name,
    cast(cast(payload as json) -> 'user' ->> 'id' as integer) as user_id,
    cast(payload as json) -> 'tags' ->> 0 as first_tag
from events;
