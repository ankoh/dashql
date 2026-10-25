-- @dashql:description
-- Return one row for every hop of the matched paths instead of one row per path.
-- @dashql:end

with
    airports(code) as (
        values ('MUC'), ('FRA'), ('JFK'), ('SFO')
    ),
    flights(origin, destination, minutes) as (
        values ('MUC', 'FRA', 55), ('FRA', 'JFK', 520), ('JFK', 'SFO', 390)
    ),
    routes as property graph (
        vertex tables (airports key (code) label airport properties (code))
        edge tables (
            flights key (origin, destination)
                source key (origin) references airports (code)
                destination key (destination) references airports (code)
                label flight properties (minutes)
        )
    )
select *
from graph_table (
    routes
    match (a is airport where a.code = 'MUC')-[is flight]->{1,3}(b is airport where b.code = 'SFO')
    one row per step (hop_from, hop, hop_to)
    columns (hop_from.code as departs, hop_to.code as arrives, hop.minutes as minutes)
) as g;
