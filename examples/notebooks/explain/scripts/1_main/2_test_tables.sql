create table if not exists nation_materialized as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/nation.parquet', format => 'parquet')
);