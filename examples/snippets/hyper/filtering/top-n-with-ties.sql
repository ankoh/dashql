-- @dashql:description
-- Return the top three rows and every row that ties with the third one.
-- rank() gives equal values the same rank, row_number() would cut ties at random.
-- @dashql:end

with scores(player, points) as (
    values ('ada', 98), ('alan', 95), ('grace', 91), ('edsger', 91), ('barbara', 87)
)
select player, points
from (
    select scores.*, rank() over (order by points desc) as place
    from scores
) ranked
where place <= 3
order by place, player;
