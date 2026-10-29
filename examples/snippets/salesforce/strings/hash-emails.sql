-- @description
-- Hash normalized email addresses, e.g. to match them with an advertising audience without sharing them.
-- `sha256` returns bytes, `encode` turns them into hex text.
-- @end

with emails(individual_id, email) as (
    values ('I-1', ' Ada@Example.com'), ('I-2', 'alan@example.com')
)
select
    individual_id,
    lower(trim(email)) as normalized_email,
    encode(sha256(lower(trim(email))), 'hex') as sha256_hex,
    md5(lower(trim(email))) as md5_hex
from emails
order by individual_id;
