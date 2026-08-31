-- With strict dialect check, the formatting fails
explain (format sql, sql_dialect internal_spark, with_dialect_check strict)
select tableau.left('❤', 1);