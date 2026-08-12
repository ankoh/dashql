explain (format sql, sql_dialect internal_spark_2025_12)
select *
from raw_sql_subquery(descriptor(foo int), 'bar')