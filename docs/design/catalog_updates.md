# Catalog Updates

How the catalog of a connection stays in line with the connection: after a statement the connection is asked about the
relations it named, the relations are kept on disk as SQL, and a full refresh runs only on user input or when nothing
describes a connection yet. The catalog types, snapshots and name resolution are described in
`core_analysis_catalog.md`, the batch worker in `catalog_batching.md`.

## Principles

- **The connection is the source of truth.** The connection layer only holds what the connection reported. A statement
  that ran says nothing about the connection: `create table if not exists t (a int)` on a `t(a, b)` still leaves `t(a, b)`.
- **Scripts state an intent.** The declarations of workbook scripts fill in what the connection doesn't have, such as the
  tables of scripts that haven't run yet. They never override it.
- **The parser decides what to ask.** A statement it can name relations of leads to a lookup of these relations. A
  statement it doesn't know leads to nothing, there is no guessing from the text.
- **Full refreshes are rare.** See [Full refreshes](#full-refreshes).

## The model

| What | Where | Written by |
|---|---|---|
| Relations of a connection | A descriptor entry (`catalogRelationEntryId`), without a script | Metadata queries |
| Relations on disk | `dashql-catalog-relations.sql` | Rendered from the descriptor |
| Open questions and relations that are gone | `dashql-catalog-state.json` | The connection state and `Catalog::absent_relations` |
| Functions of a connection | A descriptor entry with a script | Batches, they come as SQL |
| Declarations of scripts | Script entries in the session layer | The analyzer |

Names resolve against the script itself, then the connection layer, then the session layer. The matches of the first layer
that has one are the candidates, so the layers never make a name ambiguous. A name without a database is never an exact
lookup: `t` of a script has no qualification and would hit itself ahead of the `db.schema.t` of the connection.

The rows of a metadata query become descriptor tables directly (`catalog_tables_from_*`,
`pack_catalog_descriptor_of_tables` of `catalog_loader/` in `dashql_core_runtime`), no SQL is generated or parsed. The
columns keep the order of the connection.

## After a statement

1. **The parser names the relations** (`touched_relations`, `packages/dashql-core/src/touched_relations.rs`).
2. **The query executor records them** for every statement of the user that reached the backend, from a script or a shell,
   also if it failed or was cancelled: a statement of many may have run, and a cancelled one may have run all the same.
   Results from the cache and the queries of the app record nothing, and neither does Salesforce, where nothing that runs
   changes relations. The default of the connection names the database, without one a statement can't have touched
   anything.
3. **The catalog loader asks the connection** once it is online, no other update runs or is requested and it has room for
   another query (`CatalogUpdateVariant::RelationRefresh`, `catalog_loader/service.rs`). The loader is a service of the
   runtime, it runs its metadata queries as queries of the connection on the executor of the runtime. A refresh that
   runs may have read the relations too early, the update follows it, and only that answer can say that a relation is
   gone. The names of a run are merged.
4. **The answer updates the catalog** (`Catalog::replace_tables`): a relation with rows has a new table in the place of the
   old one, a relation without rows is gone. An answer that changes nothing keeps the catalog version. An answer that
   changed the catalog is announced (`Connections::announce_catalog`): the view of the connection changes, the scripts
   that use the connection are analyzed again.

| Statement | Asks about |
|---|---|
| `CREATE TABLE`, `CREATE TABLE AS`, `CREATE VIEW`, `SELECT INTO` | The relation |
| `DROP TABLE`, `DROP VIEW` | The relation |
| `ALTER TABLE` adding, dropping or renaming a column, changing its type | The relation |
| `ALTER TABLE`, `ALTER VIEW` with `RENAME TO` or `SET SCHEMA` | The old and the new name |
| `DROP SCHEMA`, `ALTER SCHEMA ... RENAME TO` | Everything in the schema, and in the new one |
| `EXPLAIN` that runs a `CREATE TABLE AS` | The relation |
| `CREATE SCHEMA` | Nothing, a new schema holds no relations |

The grammar only knows the `ALTER` actions that change what the catalog holds. Other actions don't parse and ask nothing.

**A name without a schema matches every schema.** The connection decides what such a name means: a temporary schema or one
of the search path. A name with an empty table is a whole schema. `same_relation` in `catalog/mod.rs` holds these rules.

The query of a connector selects the relations with `relation_filter` (`catalog_loader/sql.rs` of the core runtime):

| Connector | Query |
|---|---|
| Hyper | `pg_attribute` |
| Trino | `information_schema.columns`, the names folded to lower case |
| Hyper Cloud, Database.com | `_hyper_catalog` |
| Salesforce | None, it only refreshes in full |

The standalone shell runs its statements on the session of a connection of its runtime to the embedded Hyper and tells
the catalog loader about the relations they touched, the prompt returns once the loader answered
(`runtime/embedded_session.ts`).

## Relations that are gone

A relation that the connection reported as gone would come back through the declaration of a script. The snapshot
remembers it (`absent_relations`) and hides declarations of that name in resolution, completion, `flatten` and
`describe_entries`, until the connection has it again. A script still resolves its own declarations.

## Failures

An update that fails or is cancelled gives its relations back. The loader tries again after a wait, three attempts in all.
After that the catalog counts as out of date and the refresh button of the connection shows it (`catalogUpdates.outOfDate`
of the connection view), until
the next statement or a refresh. A Hyper refresh that fails for an attached database keeps the relations of that database
(`CatalogTableUpdate.databases`).

## Full refreshes

A full refresh only runs:

- on user input: the refresh buttons of a connection and the refresh command of a workbook (`refreshCatalog` of the
  runtime with `force`),
- for the initial description of a connection when it comes online and nothing describes it yet
  (`CatalogUpdates.described`): no file was restored and no refresh succeeded,
- whenever a connection whose database doesn't outlive the app comes online: its database is new.

Nothing else starts one. A restored catalog is kept until the user refreshes it. Until a connection is described, the
answers about relations update the catalog in memory but nothing saves it: a few relations aren't a catalog, and a restart
must not take them for one.

## On disk

Relations are SQL only in `dashql-catalog-relations.sql`: readable, and what workbook bundles carry. The descriptor is
rendered when the write runs, about 100 ms after an update that changed the catalog, so a run of statements saves it once
and a lookup that changed nothing writes nothing. Functions are only written by a full refresh, the only update that reads
them. Temporary relations stay out of the file, they don't outlive their database session. Restoring a connection parses the file once in the module,
publishes the descriptor and drops the text. The parser normalizes the spelling of types (`int8` is `bigint` after a
restore), the file doesn't change after that.

`dashql-catalog-state.json` holds what that file doesn't say: the relations nothing has answered about yet (`pending`) and
those that are gone (`gone`). A relation stays pending until an update answered, so a restart asks again once the connection
is online, without a refresh. A file `dashql-catalog-changes.sql` of an older version is cleared, its relations count as
pending.

A connection whose database doesn't outlive the app writes neither file, and the standalone shell keeps its catalog in
memory.

## Within a script

An `ALTER` changes the declaration of a table that its script creates, so that later statements read the table as it leaves
it, before the script ran. It declares a new version of the table that the actions change: one that moves a relation under
the new name, one that adds, drops or renames columns under the same name. The old declaration stays for the statements
before the `ALTER`. A table of `CREATE TABLE AS` gets its actions once its columns are known. All of this is intent and lives
in the session layer.

An `ALTER` of a table that the script doesn't declare changes nothing in the script: the table stays what the connection
reports, and the connection answers once the statement ran. Until then, a later statement of the script doesn't see the new
column or name.

A statement reads the last declaration of a name before it, as the database would when the script runs: `select a from t`
in front of `alter table t rename column a to b` resolves `a`, the same statement after it resolves `b`. Other scripts read
the last declaration of the script, which carries all of its `ALTER`s.

The planner doesn't model these statements, they are barriers and run in workbook order.

## Copy-on-write

`replace_tables` builds a new entry next to the old one, a published entry never changes. An analysis reads its locations
through its snapshot, which keeps the old entry alive, so tables may move in the new entry. The entry is the unit of the
copy: a connection is one entry, and an update of one table unpacks, packs and imports all of its tables. Measured on a
release build with 20 columns per table, on the main thread:

| Tables | Build a descriptor from rows | Import | `replace_tables` of one table | Without a change |
|---|---|---|---|---|
| 1,000 | 22 ms | 20 ms | 20 ms | 4 ms |
| 10,000 | 287 ms | 135 ms | 228 ms | 34 ms |

Sharing the table declarations between versions of an entry would make the update cheaper, nothing needs it yet.

## What needs a manual refresh

- Changes made outside of DashQL. They reach the catalog with the next statement that touches the relation.
- Statements the parser doesn't know, for example `DROP DATABASE` or `ALTER TABLE` actions of a dialect that change columns
  in a way the grammar doesn't cover, and `SELECT INTO` under `EXPLAIN ANALYZE`.
- Client function calls that change the relations of a connection: `CALL` goes through the REST API, not through SQL.
- The tables of a database that an `ATTACH` statement adds. The catalog describes the databases of the connection settings.
