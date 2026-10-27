-- @description
-- Find every destination that is reachable with at most two stopovers.
-- The recursion stops after three flights.
-- @end

with recursive
    flights(origin, destination) as (
        values ('MUC', 'FRA'), ('FRA', 'JFK'), ('JFK', 'SFO'), ('SFO', 'NRT')
    ),
    reachable(destination, flights_taken) as (
        select destination, 1
        from flights
        where origin = 'MUC'
        union all
        select f.destination, r.flights_taken + 1
        from reachable r
        join flights f on f.origin = r.destination
        where r.flights_taken < 3
    )
select destination, min(flights_taken) as flights
from reachable
group by destination
order by flights, destination;
