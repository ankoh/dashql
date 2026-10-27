-- @description
-- Read nested fields of a JSON document with JSON paths.
-- @end

with events(payload) as (
    values
        ('{"user": {"id": 7, "name": "Ada"}, "tags": ["admin", "beta"]}'),
        ('{"user": {"id": 8, "name": "Alan"}, "tags": []}')
)
select
    json_extract_scalar(payload, '$.user.name') as user_name,
    cast(json_extract_scalar(payload, '$.user.id') as integer) as user_id,
    json_extract_scalar(payload, '$.tags[0]') as first_tag
from events;
