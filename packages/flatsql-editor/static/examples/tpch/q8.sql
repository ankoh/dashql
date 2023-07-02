select   l_year,
         sum(amount_country) / nullif(sum(amount_all), 0) as mkt_share
from
         (select extract(year from o_entry_d) as l_year,
                 case when n2.n_name = 'Germany' then ol_amount else 0 end as amount_country,
                 ol_amount as amount_all
          from   item, supplier, stock, orderline, "order", customer, nation n1, nation n2, region
          where  i_id = s_i_id
                 and ol_i_id = s_i_id
                 and ol_supply_w_id = s_w_id
                 and mod((s_w_id * s_i_id),10000) = su_suppkey
                 and ol_w_id = o_w_id
                 and ol_d_id = o_d_id
                 and ol_o_id = o_id
                 and c_id = o_c_id
                 and c_w_id = o_w_id
                 and c_d_id = o_d_id
                 and n1.n_nationkey = ascii(substr(c_state,1,1))
                 and n1.n_regionkey = r_regionkey
                 and ol_i_id < 1000
                 and r_name = 'Europe'
                 and su_nationkey = n2.n_nationkey
                 and o_entry_d between timestamp '2007-01-02 00:00:00.000000' and timestamp '2030-01-02 00:00:00.000000'
                 and i_data like '%b'
                 and i_id = ol_i_id) as year_amount
group by l_year
order by l_year
