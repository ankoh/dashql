-- @dashql:description
-- Query a small knowledge graph with a property graph and a MATCH pattern.
-- Finds who knows someone working at a company in Berlin.
-- @dashql:end

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
    ),
    company_graph as property graph (
        vertex tables (
            people key (id) label person properties (name),
            companies key (id) label company properties (name),
            cities key (id) label city properties (name)
        )
        edge tables (
            knows key (person_id, friend_id)
                source key (person_id) references people (id)
                destination key (friend_id) references people (id)
                label knows,
            works_at key (person_id, company_id)
                source key (person_id) references people (id)
                destination key (company_id) references companies (id)
                label works_at properties (since),
            located_in key (company_id, city_id)
                source key (company_id) references companies (id)
                destination key (city_id) references cities (id)
                label located_in
        )
    )
select *
from graph_table (
    company_graph
    match (p is person)-[is knows]->(f is person)-[w is works_at]->(c is company)
        -[is located_in]->(city is city where city.name = 'Berlin')
    columns (p.name as person, f.name as friend, c.name as company, w.since as working_since)
) as g
order by person;
