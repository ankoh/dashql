-- @description
-- Split a text of tags into an array with `regexp_split_to_array`, ignoring the spaces around the separators.
-- @end

with accounts(account_id, tags) as (
    values ('A-1', 'enterprise, emea;priority'), ('A-2', 'smb'), ('A-3', 'enterprise ; amer , renewal')
)
select
    account_id,
    regexp_split_to_array(trim(tags), '\s*[,;]\s*') as tag_list,
    array_length(regexp_split_to_array(trim(tags), '\s*[,;]\s*')) as tag_count
from accounts
order by account_id;
