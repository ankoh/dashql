create table if not exists region as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/region.parquet', format => 'parquet')
);
create table if not exists nation as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/region.parquet', format => 'parquet')
);