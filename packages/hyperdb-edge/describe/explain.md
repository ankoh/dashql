# explain

`EXPLAIN` returns the plan as one row with the column `plan`. The table format prints it over several lines.

```sql
create table if not exists numbers as select g as n from generate_series(1, 1000) as s(g);
explain select count(*) from numbers where n > 10;
```

`EXPLAIN (ANALYZE)` runs the query and adds to every operator the rows it produced (`actual`) and its share of
the CPU cycles. Write the parentheses: `EXPLAIN ANALYZE` without them is a syntax error in Hyper.

```sql
explain (analyze) select count(*) from numbers where n > 10;
```

`EXPLAIN (FORMAT JSON)` returns the plan as JSON, with the estimated rows of every operator and the position of
its SQL:

```sql
explain (format json) select count(*) from numbers where n > 10;
```
