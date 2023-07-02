select  o_ol_cnt, count(*) as order_count
from    "order"
where   o_entry_d >= timestamp '2007-01-02 00:00:00.000000'
        and o_entry_d < timestamp '2030-01-02 00:00:00.000000'
        and exists (select *
                    from orderline
                    where o_id = ol_o_id
                    and o_w_id = ol_w_id
                    and o_d_id = ol_d_id
                    and ol_delivery_d >= o_entry_d)
group   by o_ol_cnt
order   by o_ol_cnt
