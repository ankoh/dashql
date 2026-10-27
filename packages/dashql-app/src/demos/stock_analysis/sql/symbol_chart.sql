-- The price range and the closing price of a symbol per second over the last 5 minutes
select
    floor(extract(epoch from ts)::double precision) * 1000 as t,
    min_by(price, ts) as open,
    max(price) as high,
    min(price) as low,
    max_by(price, ts) as close,
    sum(size) as size
from ticks
where symbol = :symbol and ts >= now() - interval '5 minutes'
group by 1
order by 1
