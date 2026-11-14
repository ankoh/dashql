# functions

`pg_proc` lists the names of the functions but not their signatures, see `catalog`. These are functions of
Hyper that Postgres lacks or names otherwise, each with a call that works.

Approximate and arbitrary values of a group:

```sql
select approx_count_distinct(g) from generate_series(1, 100) as s(g);
select any_value(g) from generate_series(1, 3) as s(g);
```

Arrays:

```sql
select array_contains(array[1, 2, 3], 2);
select array_length(array[1, 2, 3]);
```

Text:

```sql
select string_agg(x, ',' order by x) from (values ('b'), ('a')) as t(x);
```

Dates:

```sql
select date_trunc('month', date '2026-11-14');
```
