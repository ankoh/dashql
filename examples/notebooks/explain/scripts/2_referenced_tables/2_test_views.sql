create or replace view customers as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/customer.parquet', format => 'parquet')
);
create or replace view orders as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/orders.parquet', format => 'parquet')
);