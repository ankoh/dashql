# Catalog Updates

How the catalog of a connection stays in line with the connection. The catalog types, snapshots and name resolution are
described in `core_analysis_catalog.md`, the batch worker in `catalog_batching.md`.

## Principles

- **The connection is the source of truth.** The connection layer only holds what the connection reported. A statement
  that ran says nothing about the connection: `create table if not exists t (a int)` on a `t(a, b)` still leaves `t(a, b)`.
- **Scripts state an intent.** The declarations of session scripts fill in what the connection doesn't have, such as the
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

The rows of a metadata query become descriptor tables directly (`catalogTablesFrom*`, `packCatalogDescriptor`), no SQL is
generated or parsed. The columns keep the order of the connection.

## After a statement

1. **The parser names the relations** (`touched_relations`, `packages/dashql-core-session/src/touched_relations.rs`).
2. **The query executor records them** for every statement of the user that reached the backend, from a script or a shell,
   also if it failed or was cancelled: a statement of many may have run, and a cancelled one may have run all the same.
   Results from the cache and the queries of the app record nothing, and neither does Salesforce, where nothing that runs
   changes relations. The default of the connection names the database, without one a statement can't have touched
   anything.
3. **The catalog loader asks the connection** once it is online, no other update runs or is requested and it has room for
   another query (`CatalogUpdateVariant.RELATION_REFRESH`). A refresh that runs may have read the relations too early, the
   update follows it, and only that answer can say that a relation is gone. The names of a run are merged.
4. **The answer updates the catalog** (`Catalog::replace_tables`): a relation with rows has a new table in the place of the
   old one, a relation without rows is gone. An answer that changes nothing keeps the catalog version.

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

The query of a connector selects the relations with `relationFilter`:

| Connector | Query |
|---|---|
| Hyper | `pg_attribute` |
| Trino | `information_schema.columns`, the names folded to lower case |
| Hyper Cloud, Database.com | `_hyper_catalog` |
| Salesforce | None, it only refreshes in full |

The standalone shell runs on an embedded database without a connection state. It asks about the same relations with the
same query, before the prompt returns (`embedded_database_catalog.ts`).

## Relations that are gone

A relation that the connection reported as gone would come back through the declaration of a script. The snapshot
remembers it (`absent_relations`) and hides declarations of that name in resolution, completion, `flatten` and
`describe_entries`, until the connection has it again. A script still resolves its own declarations.

## Failures

An update that fails or is cancelled gives its relations back. The loader tries again after a wait, three attempts in all.
After that the catalog counts as out of date and the refresh button of the connection shows it (`isCatalogOutOfDate`), until
the next statement or a refresh. A Hyper refresh that fails for an attached database keeps the relations of that database
(`CatalogTableUpdate.databases`).

## Full refreshes

A full refresh only runs:

- on user input: the refresh buttons of a connection and the refresh command of a session,
- for the initial description of a connection when it comes online and nothing describes it yet
  (`CatalogUpdates.described`): no file was restored and no refresh succeeded,
- whenever a connection whose database doesn't outlive the app comes online: its database is new.

Nothing else starts one. A restored catalog is kept until the user refreshes it. Until a connection is described, the
answers about relations update the catalog in memory but nothing saves it: a few relations aren't a catalog, and a restart
must not take them for one.

## On disk

Relations are SQL only in `dashql-catalog-relations.sql`: readable, and what session bundles carry. The descriptor is
rendered when the write runs, about 100 ms after an update that changed the catalog, so a run of statements saves it once
and a lookup that changed nothing writes nothing. Functions are only written by a full refresh, the only update that reads
them. Temporary relations stay out of the file, they don't outlive their database session. Restoring a connection parses the file once in the batch worker,
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
it, before the script ran. It adds, drops and renames the columns of the declaration. One that moves a relation declares the
new name and keeps the old one for the statements before it. A table of `CREATE TABLE AS` gets its actions once its columns
are known. All of this is intent and lives in the session layer.

An `ALTER` of a table that the script doesn't declare changes nothing in the script: the table stays what the connection
reports, and the connection answers once the statement ran. Until then, a later statement of the script doesn't see the new
column or name.

A script has one table of a name. Its last declaration wins, for the script and for other scripts, and it carries all the
`ALTER`s of the script. A statement in front of an `ALTER` that drops or renames a column of a table of the same script reads
the table as it ends up, and reports the old name as unresolved.

The planner doesn't model these statements, they are barriers and run in session order.

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
