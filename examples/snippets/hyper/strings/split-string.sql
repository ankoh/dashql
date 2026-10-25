-- @dashql:description
-- Pick the parts of a delimited string by position.
-- @dashql:end

with paths(path) as (
    values ('2026/01/report.csv'), ('2026/02/summary.parquet')
)
select
    path,
    split_part(path, '/', 1) as year,
    split_part(path, '/', 2) as month,
    split_part(path, '/', 3) as file_name
from paths;
