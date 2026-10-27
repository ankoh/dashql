-- The trades per second over the last minute
select
    floor(extract(epoch from ts)::double precision) * 1000 as t,
    count(*)::double precision as trades
from ticks
where ts >= now() - interval '60 seconds'
group by 1
order by 1
