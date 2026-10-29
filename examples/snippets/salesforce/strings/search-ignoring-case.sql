-- @description
-- Find accounts by a part of their name, ignoring case with `ilike`.
-- @end

with accounts(account_id, name) as (
    values ('A-1', 'Acme Corporation'), ('A-2', 'ACME Logistics'), ('A-3', 'Globex'), ('A-4', 'Initech Acme Labs')
)
select
    account_id,
    name,
    name like '%Acme%' as matches_case_sensitive
from accounts
where name ilike '%acme%'
order by account_id;
