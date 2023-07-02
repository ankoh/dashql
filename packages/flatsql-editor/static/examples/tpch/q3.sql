select   ol_o_id, ol_w_id, ol_d_id,
         sum(ol_amount) as revenue, o_entry_d
from     customer, neworder, "order", orderline
where    c_state like 'A%'
         and c_id = o_c_id
         and c_w_id = o_w_id
         and c_d_id = o_d_id
         and no_w_id = o_w_id
         and no_d_id = o_d_id
         and no_o_id = o_id
         and ol_w_id = o_w_id
         and ol_d_id = o_d_id
         and ol_o_id = o_id
         and o_entry_d > timestamp '2007-01-02 00:00:00.000000'
group by ol_o_id, ol_w_id, ol_d_id, o_entry_d
order by revenue desc, o_entry_d
limit    100
