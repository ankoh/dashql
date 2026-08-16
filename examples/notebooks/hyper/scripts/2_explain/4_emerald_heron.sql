explain (analyze, format internal)
with part as (
    select * from external('/mnt/home/Desktop/data/tpch-1/v1/part.parquet', format => 'parquet')
), partsupp as (
    select * from external('/mnt/home/Desktop/data/tpch-1/v1/partsupp.parquet', format => 'parquet')
), nation as (
	select * from external('/mnt/home/Desktop/data/tpch-1/v1/nation.parquet', format => 'parquet')
), supplier as (
	select * from external('/mnt/home/Desktop/data/tpch-1/v1/supplier.parquet', format => 'parquet')
), region as (
	select * from external('/mnt/home/Desktop/data/tpch-1/v1/region.parquet', format => 'parquet')
)
select s_acctbal,
    s_name,
    n_name,
    p_partkey,
    p_mfgr,
    s_address,
    s_phone,
    s_comment
from supplier, part, partsupp, nation, region
where p_partkey = ps_partkey
    and s_suppkey = ps_suppkey
    and p_size = 15
    and p_type like '%BRASS'
    and s_nationkey = n_nationkey
    and n_regionkey = r_regionkey
    and r_name = 'EUROPE'
    and ps_supplycost = (
            select min(ps_supplycost)
            from supplier, partsupp, nation, region
            where p_partkey = ps_partkey
                and s_suppkey = ps_suppkey
                and s_nationkey = n_nationkey
                and n_regionkey = r_regionkey
                and r_name = 'EUROPE'
        )
order by s_acctbal desc, n_name, s_name, p_partkey
limit 100;
