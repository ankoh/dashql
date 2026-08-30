create table if not exists region as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/region.parquet', format => 'parquet')
);
create table if not exists customers as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/customer.parquet', format => 'parquet')
);
create table if not exists orders as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/orders.parquet', format => 'parquet')
);
create table if not exists nation as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/nation.parquet', format => 'parquet')
);
create table if not exists lineitem as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/lineitem.parquet', format => 'parquet')
);