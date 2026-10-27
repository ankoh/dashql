-- @description
-- Extract, replace and match text with regular expressions.
-- @end

with log_lines(line) as (
    values ('2026-01-01 ERROR order 4711 failed after 3 retries'),
           ('2026-01-01 INFO order 4712 shipped')
)
select
    regexp_extract(line, '(ERROR|WARN|INFO)') as level,
    cast(regexp_extract(line, 'order ([0-9]+)', 1) as integer) as order_id,
    regexp_replace(line, '[0-9]+', '#') as pattern,
    regexp_like(line, 'retr(y|ies)') as retried
from log_lines;
