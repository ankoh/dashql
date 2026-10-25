-- @dashql:description
-- Find every destination that is reachable with at most two stopovers.
-- The quantifier {1,3} matches paths of one to three flights.
-- @dashql:end

with
    airports(code, city) as (
        values ('MUC', 'Munich'), ('FRA', 'Frankfurt'), ('JFK', 'New York'),
               ('SFO', 'San Francisco'), ('NRT', 'Tokyo')
    ),
    flights(origin, destination) as (
        values ('MUC', 'FRA'), ('FRA', 'JFK'), ('JFK', 'SFO'), ('SFO', 'NRT')
    ),
    routes as property graph (
        vertex tables (airports key (code) label airport properties (code, city))
        edge tables (
            flights key (origin, destination)
                source key (origin) references airports (code)
                destination key (destination) references airports (code)
                label flight
        )
    )
select distinct destination, city
from graph_table (
    routes
    match (a is airport where a.code = 'MUC')-[is flight]->{1,3}(b is airport)
    columns (b.code as destination, b.city as city)
) as g
order by destination;
