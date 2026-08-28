create table part as (
	select * from external('/mnt/home/Desktop/data/tpch-1/v1/part.parquet', format => 'parquet')
);