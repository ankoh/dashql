-- @dashql:description
-- Translate single expressions into the SQL dialect of Spark, with the columns they read.
-- @dashql:end

explain (format sql_expressions, sql_dialect internal_spark_2025_12, columns descriptor(price numeric(10, 2), quantity int))
expressions (
    price * quantity,
    quantity between 1 and 10,
    coalesce(price, 0) + 1
);
