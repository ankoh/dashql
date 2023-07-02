select   ol_number,
         sum(ol_quantity) as sum_qty,
         sum(ol_amount) as sum_amount,
         avg(ol_quantity) as avg_qty,
         avg(ol_amount) as avg_amount,
         count(*) as count_order
from     orderline
where    ol_delivery_d > timestamp '2007-01-02 00:00:00.000000'
group by ol_number order by ol_number
