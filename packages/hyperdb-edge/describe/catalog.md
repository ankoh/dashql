# catalog

Hyper has no `information_schema` and no `DESCRIBE` or `SHOW TABLES`. Ask `pg_catalog` instead.

The examples use this table:

```sql
create table if not exists sales(region text, amount numeric(10,2), sold date);
```

The tables:

```sql
select schemaname, tablename
from pg_catalog.pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename;
```

The columns of a table and their types:

```sql
select a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
where c.relname = 'sales' and a.attnum > 0
order by a.attnum;
```

Or select no rows: `--format json` prints the columns with their types.

```sql
select * from sales limit 0;
```

The functions, by name. `pg_proc` has no signatures in Hyper, see `functions` for some of them.

```sql
select distinct proname from pg_catalog.pg_proc where proname like 'regexp%' order by proname;
```

The settings, see `settings`:

```sql
select name, setting from pg_catalog.pg_settings where name like 'search_path%';
```
