# settings

Engine settings apply to the whole engine and are set when it starts: `--setting NAME=VALUE`, repeatable.
`true` and `false` are booleans, whole numbers are numbers, anything else is text. The engine refuses an unknown
setting, the call then fails with exit code 2.

Session settings change with `SET` within a call:

```sql
set application_name = 'reports';
show application_name;
```

`show all` lists every setting with its description, `pg_settings` lets you filter them:

```sql
select name, setting from pg_catalog.pg_settings where name like 'application%';
```
