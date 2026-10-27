-- @description
-- Query a small knowledge graph of people, companies and cities by joining its edges.
-- Finds who knows someone working at a company in Berlin.
-- @end

with
    people(id, name) as (
        values (1, 'Ada'), (2, 'Alan'), (3, 'Grace'), (4, 'Edsger')
    ),
    companies(id, name) as (
        values (10, 'Analytical Engines'), (11, 'Compiler Works')
    ),
    cities(id, name) as (
        values (100, 'Berlin'), (101, 'Munich')
    ),
    knows(person_id, friend_id) as (
        values (1, 2), (2, 3), (3, 4), (4, 1)
    ),
    works_at(person_id, company_id, since) as (
        values (2, 10, 2019), (3, 11, 2021), (4, 10, 2024)
    ),
    located_in(company_id, city_id) as (
        values (10, 100), (11, 101)
    )
select p.name as person, f.name as friend, c.name as company, w.since as working_since
from people p
join knows k on k.person_id = p.id
join people f on f.id = k.friend_id
join works_at w on w.person_id = f.id
join companies c on c.id = w.company_id
join located_in l on l.company_id = c.id
join cities city on city.id = l.city_id
where city.name = 'Berlin'
order by person;
