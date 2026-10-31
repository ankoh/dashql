/**
 * @description
 * The share of profiles with a value in each field, a quick data quality check of a mapping.
 * `count` of a column skips the nulls.
 */

with individuals(individual_id, first_name, last_name, birth_date, city) as (
    values ('I-1', 'Ada', 'Lovelace', date '1815-12-10', 'London'),
           ('I-2', 'Alan', 'Turing', null, 'Manchester'),
           ('I-3', 'Grace', null, date '1906-12-09', null),
           ('I-4', null, 'Dijkstra', null, 'Austin')
)
select
    count(*) as individuals,
    round(100.0 * count(first_name) / count(*), 1) as first_name_pct,
    round(100.0 * count(last_name) / count(*), 1) as last_name_pct,
    round(100.0 * count(birth_date) / count(*), 1) as birth_date_pct,
    round(100.0 * count(city) / count(*), 1) as city_pct
from individuals;
