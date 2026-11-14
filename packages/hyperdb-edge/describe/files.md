# files

The engine reaches only the working folder, mounted at `/mnt/external/work`. Paths in SQL are absolute paths
below it: `sales.parquet` in the working folder is `/mnt/external/work/sales.parquet`. Relative paths and other
folders don't resolve.

Write a result to Parquet or CSV with `COPY`:

```sql
copy (select 'north' as region, 10.5 as amount union all select 'south', 20)
to '/mnt/external/work/sales.parquet' with (format => 'parquet');
copy (select 'north' as region, 10.5 as amount)
to '/mnt/external/work/sales.csv' with (format => 'csv', header => true);
```

Read Parquet with `external()`, the file has the columns and their types:

```sql
select region, amount from external('/mnt/external/work/sales.parquet') order by region;
```

CSV needs the columns, Hyper can't infer them:

```sql
select *
from external('/mnt/external/work/sales.csv',
    format => 'csv', header => true, columns => descriptor(region text, amount numeric(10,2)));
```

Load a file into a table of the database:

```sql
create table if not exists sales_import as select * from external('/mnt/external/work/sales.parquet');
```

Arrow IPC streams read with `format => 'arrowstream'` and need the columns as well.
