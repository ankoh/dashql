create or replace view tpch_customer as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/customer.parquet', format => 'parquet')
);
create or replace view tpch_orders as (
	select * from external('https://data.dashql.app/tpch-0.01/v1/orders.parquet', format => 'parquet')
);