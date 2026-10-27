-- The live board: per symbol the last trade of the last 24 hours, its change against the first one, and the volume
with day as (
    select
        symbol,
        max_by(price, ts) as last,
        min_by(price, ts) as open,
        max_by(bid, ts) as bid,
        max_by(ask, ts) as ask,
        sum(price * size) as volume,
        count(*) as trades,
        max(ts) as updated
    from ticks
    where ts >= now() - interval '24 hours'
    group by symbol
)
select
    symbol,
    last,
    open,
    last - open as change,
    case when open = 0 then null else (last - open) / open end as change_ratio,
    bid,
    ask,
    volume,
    trades::double precision as trades,
    extract(epoch from updated)::double precision * 1000 as updated_ms
from day
order by symbol
