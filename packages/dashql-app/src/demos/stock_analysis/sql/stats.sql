-- The size of the table
select
    count(*)::double precision as rows,
    count(distinct symbol)::double precision as symbols
from ticks
