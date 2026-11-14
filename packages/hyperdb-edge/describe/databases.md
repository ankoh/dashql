# databases

`--db sales.hyper` creates the file when missing and attaches it as `sales`, the name of the file without
`.hyper`. Unqualified table names resolve to it, qualified ones read `sales.public.orders`. The tables stay in the
file for the next call. Every call starts a new engine, so temporary tables end with the call.

```sql
create table if not exists orders(id int, region text);
insert into orders values (1, 'north'), (2, 'south');
select count(*) from orders;
```

Further databases live in the folder of the opened file. Create and attach them by their file name. While a
second database is attached, unqualified table names don't resolve: qualify every table with its database.

```sql
create database if not exists "archive.hyper";
attach database "archive.hyper" as archive;
create table if not exists archive.public.old_orders(id int, region text);
insert into archive.public.old_orders select * from sales.public.orders;
detach database archive;
select count(*) from orders;
```

Without `--db` no database is open. `create table` then fails, a temporary table works:

```sql
create temporary table scratch as select 1 as x;
select x from scratch;
```

- A call holds a lock on the database file, `sales.hyper.lock` next to it. A second call on the same file fails
  with exit code 2 while the first runs; run the calls one after another.
- The engine writes its log into `logs/` in the folder of the database.
