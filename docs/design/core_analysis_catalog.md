# Analysis and Catalog

How the Rust core (`packages/dashql-core`, with the editor session in `packages/dashql-core-session`)
analyzes scripts, publishes their declarations into a catalog, resolves names across catalog entries,
and decides when an analysis is stale. It covers the core types, the editor session on top of them,
the wasm boundary, and the way the app drives them.

## Overview

```
 text ──scan──▶ ScannedScript ──parse──▶ ParsedScript ──analyze(catalog)──▶ AnalyzedScript
                 Arc, immutable           Arc, immutable                      Arc, immutable
                                                                                   │
                                          load_script(analysis, layer) ◀───────────┘
                                                     │
 ┌───────────────────────────────── Catalog ─────────▼──────────────────────────────────┐
 │  current             Arc<CatalogSnapshot>            ← copied on write                │
 │  ids                 canonical database and schema ids, never reused                 │
 │ ┌───────────────────────────── CatalogSnapshot ─────────────────────────────────────┐ │
 │ │ script entries      (PublishedScript, CatalogLayer) ← declarations of editor scripts│ │
 │ │ descriptor entries  Arc<DescriptorEntry>            ← schemas of connections       │ │
 │ │ global indexes      by layer, by schema, by (database, schema)                    │ │
 │ │ version             bumped when what other entries resolve against changes        │ │
 │ └───────────────────────────────────────────────────────────────────────────────────┘ │
 └───────────────────────────────────────────────────────────────────────────────────────┘
                                                     │
                     analyze(other script, catalog) ─┘  resolves names against the current
                                                        snapshot, except its own entry, and
                                                        keeps that snapshot
```

- Every stage produces an immutable snapshot behind an `Arc`. A later stage holds the earlier one
  (`AnalyzedScript.parsed`, `ParsedScript.scanned`), so one `Arc<AnalyzedScript>` keeps the whole
  pipeline of that text version alive.
- An analysis reads the catalog, but publishing is an explicit step of the owner
  (`Catalog::load_script`, `ScriptSession::load_into_catalog`). Analyzing never publishes.
- The catalog holds immutable entries. Publishing replaces an entry; nothing mutates a published
  entry in place.
- The catalog keeps only the declarations and names of a published script, never the analysis
  itself. Releasing an analysis frees its AST even while its declarations stay published.
- An analysis keeps the catalog snapshot it resolved against. Its catalog locations always refer to
  that snapshot, and it is current while the catalog's version is the snapshot's version.

## Identity

| Id | Type | Scope | Allocated by |
|---|---|---|---|
| Catalog id | `u64` | process | `NEXT_CATALOG_ID` on `Catalog::new` / `with_entry_ids`, carried by every snapshot. `load_scripts` rejects analyses of another catalog's snapshot (`CATALOG_MISMATCH`). |
| Catalog entry id | `CatalogEntryId = u32` | an `EntryIdSource` | `Catalog::allocate_entry_id`, from `INITIAL_ENTRY_ID = 1`. Catalogs that share a source never hand out the same id. The wasm module shares one source across all its catalogs (`ENTRY_IDS` in `dashql-core-wasm`). |
| Database id | `u32` | catalog | Reserved by name on first use, from `INITIAL_DATABASE_ID = 256`. Never reused. |
| Schema id | `u32` | catalog | Reserved by (database, schema) on first use, from `INITIAL_SCHEMA_ID = 65536`. Never reused. |
| Table / function id | `ExternalObjectId { origin, object }` | entry | `origin` is the declaring entry. `object` is reserved by (entry, qualified name, occurrence of the name in the entry), see below. |
| Column id | (table id, column id) | table | Reserved by (table, column name, occurrence of the name in the table). |
| Name id | `NameId = u32` | entry | Index in the name registry of the declaring script or descriptor. |

`QualifiedCatalogObjectId` (`catalog/ids.rs`) packs any of these into (type, u64, u32): database,
schema (database id, schema id), table (packed `ExternalObjectId`), column (packed table id, column
id), function. These are the ids the boundary exposes (semantic spans, cursor context, completion
candidates, flat catalog).

**Stable ids.** Table, function and column ids are keyed by name, not by position:
`Catalog::reserve_table_id`, `reserve_function_id` and `reserve_column_id` hand out the next id of
the entry (or table) for a name seen first, and the same id for a name seen before. A script keeps
the ids of its tables and columns while it is edited, also when a declaration is inserted in front of
them, and a connection descriptor keeps them when a refresh lists the tables in another order
(`catalog_test::declarations_keep_their_ids_when_the_script_moves_them`,
`catalog_descriptor_test::replaced_descriptors_keep_the_ids_of_their_tables`). A name declared twice
in one entry, e.g. after a DROP, is told apart by its occurrence. A fresh entry gets its ids in
declaration order, so they equal the positions until the entry is edited. The ids carry the declaring
entry; positions within the entry are `TableLoc` / `ColumnLoc` and are looked up by id through
`CatalogEntryData::tables_by_id` and `TableDeclaration::column_by_id`.

**Consequences**
- Ids are reserved through `&Catalog` (`RefCell<IdReservations>`), so analysis has a side effect on
  the catalog even though it borrows it immutably.
- Database and schema ids survive drops and `clear`. The table, function and column ids of an entry
  are released when the entry is dropped (`drop_script`, also for scripts that were analyzed but
  never published, and `drop_descriptor`); a later version gets its ids in declaration order again.
  `drop_script` leaves the ids of a descriptor pool that is published under the same entry id, the
  pool keeps them until `drop_descriptor`.
- While a script is typed, every intermediate name of a declared table reserves an id until the
  script is dropped.

## Catalog entries

```rust
pub enum CatalogEntryRef {
    Script(PublishedScript),          // the declarations and names of a published analysis
    Descriptor(Arc<DescriptorEntry>), // a schema imported from a CatalogDescriptor FlatBuffer
}

pub struct PublishedScript {
    pub catalog_id: u64,                // the catalog the script was analyzed against
    pub entry: Arc<CatalogEntryData>,   // shared with the analysis
    pub names: Arc<NameSearchIndex>,    // shared with the analysis
}
```

`AnalyzedScript::publication()` (or `From<Arc<AnalyzedScript>>`) produces the `PublishedScript`, so
`Catalog::load_script` accepts an analysis directly while the catalog module does not depend on the
analyzer.

Both kinds expose their declarations as one shared `Arc<CatalogEntryData>` (`catalog/entry.rs`):

| Field | Content |
|---|---|
| `database_references`, `schema_references` | The databases and schemas the entry declares into or references, with their canonical ids |
| `table_declarations` | `TableDeclaration`: object id, schema id, qualified name, columns (each with its column id and location), `is_view`, AST positions and the location of the name in the declaring script |
| `function_declarations` | `FunctionDeclaration`: object id, schema id, name, params, return type, aggregate flag, location of the name |
| `tables_by_id` | Table positions by the object part of the table id |
| `tables_by_qualified_name`, `tables_by_unqualified_name`, `tables_by_unqualified_schema` | Table lookups: exact, by name, by (schema, database) range |
| `table_columns_by_name` | Columns by name across all tables of the entry |
| `functions_by_*` | Function lookups |
| `catalog_version` | The catalog version the entry was created against |

Names are `Name { entry, id, text: Arc<str> }`. The text is shared, so a qualified name copied from
another entry stays valid without borrowing that entry's name registry.

**Script entries** are produced by the analyzer from `CREATE TABLE`, `CREATE TABLE AS`,
`CREATE VIEW`, `SELECT INTO` and `CREATE FUNCTION`. Derived tables (`AS SELECT`) get their columns
from the output columns of the defining scope. A column that is passed through keeps the type of its
source, other expressions have no type because the analyzer doesn't type expressions.

**Descriptor entries** (`catalog/descriptor.rs`) import a `CatalogDescriptor` FlatBuffer: validated
(`validate_descriptor`), then registered name by name. The relations of a connection are always a descriptor, built from
the rows of its metadata query, see [The relations of a connection](#the-relations-of-a-connection). They keep their bytes
(`DescriptorEntry.bytes`), a replacement with the same bytes changes nothing. Their tables carry
`catalog_version = version + 1`, the version they are published with. Script tables carry 0.

### Declaration locations

Tables, columns and functions of a script carry a `location`: the UTF-8 byte span of the declaration in the
script, the name of a table or function and the definition of a column. Derived columns (`CREATE TABLE AS`, views) have
no location. A descriptor has no script, so its declarations have no location either: `pack_catalog_descriptor` leaves
them out.

### Name search index

Completion searches names by substring. A `NameSearchIndex` holds the names of an entry (text,
tags, occurrences, the objects they declare) and, sorted on the first search (`OnceLock`), every
suffix of every name, case-insensitively, so a prefix search over the suffixes finds substring
matches. An analysis collects its names when it finishes and shares the index with the catalog
(`Arc`), so publishing doesn't copy it and an index sorted for completion in one script is reused
by the others.

## The catalog

```rust
pub struct Catalog {
    current: Arc<CatalogSnapshot>,
    ids: RefCell<IdReservations>,    // canonical ids, outlive snapshots
    entry_ids: EntryIdSource,
}

#[derive(Clone)]
pub struct CatalogSnapshot {
    id: u64,
    version: CatalogVersion,
    entries: HashMap<CatalogEntryId, CatalogEntryRef>,
    script_entries: HashMap<CatalogEntryId, (PublishedScript, CatalogLayer)>,
    descriptor_entries: HashMap<CatalogEntryId, Arc<DescriptorEntry>>,
    entries_ranked: BTreeSet<(CatalogLayer, CatalogEntryId)>,
    entries_by_qualified_schema: BTreeMap<(db, schema, CatalogLayer, CatalogEntryId), SchemaEntryInfo>,
    entries_by_schema: BTreeMap<(schema, CatalogLayer, CatalogEntryId), SchemaEntryInfo>,
    databases: BTreeMap<db, Arc<DatabaseDeclaration>>,
    schemas: BTreeMap<(db, schema), Arc<SchemaDeclaration>>,
    client_function_specs: BTreeMap<namespace, Arc<ClientFunctionSpec>>,
}
```

All reads (resolution, lookups, `flatten`, `describe_entries`) are methods of `CatalogSnapshot`;
`Catalog` derefs to its current snapshot. Modifications go through `DerefMut`, which is
`Arc::make_mut`: the first modification copies the snapshot if an analysis still holds it, so a
published snapshot never changes. The copy clones the maps of entry `Arc`s, O(entries + schemas).
`CatalogSnapshot` and `AnalyzedScript` are `Send + Sync`.

`Catalog::is_current(snapshot)` holds while the snapshot belongs to the catalog and has its version.

**Layers.** Every entry is published in a `CatalogLayer`. Names resolve in this order, in
resolution and in `flatten`, and within a layer against the entry with the older (smaller) entry id:

| Layer | Content | Published by |
|---|---|---|
| `CONNECTION` | What the connection reports | Catalog updates (`catalog_loader.tsx`), restored files and functions through batches (`catalog_batch.ts`), the catalog of the standalone shell (`embedded_database_catalog.ts`), the CLI's schema files |
| `SESSION` | The declarations of the scripts of a session | `ScriptSession::load_into_catalog`; in JS `loadIntoCatalog()` takes no layer |

The connection is the source of truth: the connection layer only holds what the connection reported,
and it wins over the declarations of other scripts. Those fill in what it doesn't have, such as the
tables of a script that hasn't run yet (`catalog_descriptor_test::the_connection_shadows_session_scripts_whatever_their_entry_ids`,
`session_scripts_fill_in_the_relations_the_connection_does_not_have`). A script resolves its own declarations first,
also when the connection has the name
(`a_script_resolves_its_own_declarations_first`).
`CatalogLayer` is a FlatBuffers enum; publishing rejects other values, and the JS wrapper checks
them before the bindings would wrap them into a byte.

### Operations and versions

`version` starts at 1. It is the invalidation signal for everything that resolved against the
catalog, so it only moves when what other entries resolve against may have changed.

| Operation | Effect | Version |
|---|---|---|
| `load_script` / `load_scripts` | Publish analyses atomically. Validates catalog id, entry id collisions and canonical ids (`CATALOG_ID_OUT_OF_SYNC`). | **Unchanged** if every analysis replaces a published script in the same layer and `CatalogEntryData::same_declarations`; the entries are swapped in place. Otherwise +1 and all indexes are rebuilt. |
| `drop_script` | Remove a script entry and its index entries. | +1 if the entry existed |
| `replace_descriptor` | Import descriptor bytes and publish them. | **Unchanged** if the entry holds the same bytes in the same layer. Otherwise +1. |
| `replace_tables` | Unpack a descriptor, update tables by name, replace it. | As `replace_descriptor`. **Unchanged** if the update leaves the tables as they are. |
| `drop_descriptor` | Remove a descriptor. | +1 if it existed |
| `clear` | Remove all entries (id reservations and client function specs stay). | +1 |
| `register_client_functions` | Parse a spec and shadow its namespace. A taken namespace is an error. | +1 |
| `drop_client_functions` | Remove the spec of a namespace. | +1 if it existed |

`same_declarations` compares what other entries resolve against: the ids and names of databases,
schemas, tables, columns and functions, plus column order, function params and return types. It
ignores AST positions, source locations and name ids. Tables also compare `is_view` and their
`catalog_version`. So typing in a query of a script that also declares
tables republishes without a version bump, while adding a column, renaming a table or changing the layer
bumps it. Other scripts read the locations for the declaration under the cursor: an analysis that is
current reads them from the catalog, its snapshot holds the locations of the earlier publish.

A rebuilding publish stages new maps and swaps them in at the end, so a failed publish leaves the
catalog unchanged.

**Client function specs** come with the connector of a connection and not from its backend, so
`clear` keeps them. They are no entries: they have no layer and no declarations, `flatten` and
`describe_entries` leave them out, and the app doesn't store them. A snapshot holds them so that an
analysis and completion read the spec of the catalog version they resolved against, see
[Client functions](client_functions.md#namespaces).

### Resolution

`CatalogSnapshot::resolve_table(name, ignore_entry, out, limit)` (`catalog/mod.rs`):

| Name | Strategy |
|---|---|
| `db.schema.table` | Exact lookup in the entries of (db, schema), in resolution order. |
| `schema.table` | Entries that populate the schema in any database, in resolution order. |
| `table` | All entries in resolution order, by unqualified name. |

`ignore_entry` is the analyzing script's own entry id: a script resolves its own declarations from
its in-progress analysis, never from its published version. Further matches up to `limit` of the first
layer that has a match are kept as alternatives for ambiguity errors, the layers don't compete. A name
without a database is never an exact lookup: `create table t` of a script has no qualification and would
hit `t` directly, ahead of the `db.schema.t` of the connection.

## Analysis

`analyze(parsed, catalog)` (`analyzer/mod.rs`) runs four passes over the post-order AST, interleaved
in morsels of 1024 nodes so that expression ids come out in a fixed order. The visualizations are
built after the scan:

| # | Pass | Output |
|---|---|---|
| 1 | Name resolution (`name_resolution.rs`) | Scopes, table and column references, declarations, inferred schemas |
| 2 | Function calls (`function_calls.rs`) | Function call expressions and their arguments |
| 3 | Constant propagation (`constants.rs`) | Constant expression roots |
| 4 | Parameters (`parameters.rs`) | `parameters`, sorted by their position in the text, a scalar parameter with the structured type of its cast (`sql_types.rs`) |
| - | Visualizations (`vis_tags.rs`, after the scan) | `VisualizationSpec`s of the `@vis` tags of queries, `flow` of the first `@flow` tag |
| - | Inputs (`param_tags.rs`, after the scan) | `inputs`, the first `@param :name = <literal>` tag of every name, the literal read by `sql_literal` (see `session_inputs.md`) |

`analyze_with(parsed, catalog, table_parameters)` also takes the `TableParameters` of the session
(`table_parameters.rs`): the output columns of its single-SELECT scripts and of its attachments, declared as the tables of the
reserved entry `TABLE_PARAMETERS_ENTRY_ID`, which named table parameters read (see `script_references.md`).
`analyze` passes none.

All passes share `AnalysisState` (`analyzer/state.rs`): the parsed script, the catalog, the name
texts, the output `AnalyzedScript`, and `expression_index` (AST node → expression), through which
later passes find what earlier ones produced. The output is a set of flat arenas indexed by `u32`
ids (`expressions`, `table_references`, `name_scopes`, `function_arguments`, …) with id-based links
between them.

### Name resolution

During the AST scan the pass collects table refs, column refs, result targets, CTEs and column
definitions per node and merges them upward. At scope roots (`SELECT`, `CREATE`) it
creates a `NameScope` and links it to its parent. Declarations are registered as they are visited:
`register_schema` reserves the database and schema ids and adds the references to the script's own
`CatalogEntryData`.

`finish` then:
1. indexes the script's declarations (`index_declarations`)
2. resolves names in three sweeps over the scope tree: bottom-up (tables against CTEs, the script and
   the catalog; columns against the tables and child outputs of the scope), top-down (correlated
   references from parent scopes), then the remaining unresolved columns against the unresolved tables
3. materializes derived tables from the output columns of their defining scopes
4. assigns statement ids
5. solves schema inference: columns referenced on tables that are not in the catalog become
   `InferredTableSchema`s with a confidence
6. binds explicit INSERT target columns

Results:

```rust
enum ReferencedTable { Table(TableLoc), Cte(CteLoc), Subquery(ScopeId), Unresolved(..) }
enum ColumnResolution { Unresolved, TableColumn(ColumnLoc), ScopeColumn { scope, column } }
```

`TableLoc { entry, index }` and `ColumnLoc { table, column }` point into the declarations of an
entry: the script itself or any catalog entry.

### The snapshot of an analysis

A `TableLoc` into another entry is only meaningful against that entry's declarations as they were
at analysis time. The catalog can replace or drop the entry later, so the analysis keeps the
snapshot it resolved against:

```rust
pub snapshot: Arc<CatalogSnapshot>
```

`AnalyzedScript::table(loc)` resolves through the script's own entry, then its `TableParameters`, then
the snapshot. Encoding
(`pack.rs`), the cursor and completion read the catalog only through it
(`catalog_test::analyses_keep_the_snapshot_they_resolved_against`). The snapshot also contains the
script's own published version, which the analysis ignores.

Snapshots and catalog entries hold **declarations and names only**, never analyses. An analysis
holds a snapshot; if snapshots held analyses, two scripts that reference each other and are
published in turn would form an unbounded chain A₃ → S₃ → B₂ → S₂ → A₂ → …, keeping every earlier
version of both alive. A snapshot owns no analysis, so the chain stops after one level
(`catalog_test::republished_scripts_do_not_retain_earlier_versions`,
`catalog_test::published_scripts_do_not_retain_their_analysis`).

### What an analysis records about the catalog

| Field | Use |
|---|---|
| `snapshot` | The declarations behind its cross-entry locations; its id and version decide whether the analysis is current and whether it may be published into a catalog |
| `entry.catalog_version` | The catalog version its own declarations were created against |
| Resolved ids in table and column refs | Exposed to the editor (semantic spans, cursor context) with `referenced_catalog_version` |

## Staleness

An analysis is current when nothing it read has changed. Three counters exist:

| Counter | Owner | Bumped by |
|---|---|---|
| `text_version: u64` | `Script` | Every committed text edit |
| `catalog.version: u32` | `Catalog` | See [Operations and versions](#operations-and-versions) |
| `state_revision: u64` | `ScriptSession` | Every committed change of text, selection or analysis; the editor reconciles by it |

`ScriptSession::is_analysis_current` (`script_session.rs`) requires:
- the parsed and scanned scripts of the analysis are the current ones (`Arc::ptr_eq` along the
  chain) and were scanned from the current text version
- `catalog.is_current(&analyzed.snapshot)`
- if the script has table parameters, the analysis holds the script's current `TableParameters`
  (`Script::table_parameters_current`, `Arc::ptr_eq`)

The planner applies the same catalog check per input (`planner.rs`, "stale catalog analysis").

A publish with unchanged declarations copies the snapshot without bumping the version, so the
analyses of other scripts stay current. Their older snapshot declares the same objects at the same
positions as the current one, so their locations stay valid in both.

### Editing a published script

A text edit does **not** remove the script from the catalog. Other scripts keep resolving against
its last published declarations until the owner publishes the new analysis, and the analysis of the
edited script ignores its own entry (`ignore_entry` in resolution, own-id filter in completion,
own entry first in `AnalyzedScript::table`). With equal declarations, the republish leaves the version unchanged, and no other
analysis goes stale.

A publish that does bump the version makes the publishing script's own analysis stale too: its
snapshot is now older than the catalog. The next `analyze` re-analyzes it against the
new version, and republishing that analysis is a no-op. So the system converges after one extra
analysis per declaration change.

## Editor session

`ScriptSession` (`script_session.rs`) owns one `Script` but not its catalog. Every call that reads the
catalog takes it (`&Catalog`), publishing takes it mutably, and a session belongs to the catalog it was
created with (checked in debug builds). The core holds no shared catalog: the wasm module and the
tests pair the catalog with the session.

| Call | Catalog effect |
|---|---|
| `apply(catalog, event)` | None; analyzes if `event.analyze` or if a selection change meets a stale analysis |
| `analyze(catalog)` | None; re-analyzes if not current |
| `load_into_catalog(&mut catalog, layer)` | `load_script` of the analysis |
| `drop_from_catalog(&mut catalog)` | `drop_script` |
| `Drop` | None; the owner drops the script from the catalog |

The shell (`dashql_core_shell::ShellSession`) follows the same rule: calls that read the catalog take it.

Every update carries `catalog_revision` and `analysis_available`; the full projection (diagnostics,
syntax and semantic spans, cursor, annotations, statistics) is included only when the analysis is
current.

**Analysis versions.** A current analysis is identified by the text version and the catalog version
it was analyzed at. An `EditorEvent` names the version of the analysis the host holds
(`known_analysis`). If the analysis after the event has that version, the update sets
`analysis_omitted` and leaves out diagnostics, spans, annotations and statistics; the cursor state
and context are always included. `analyze` and the `replace_text` and `set_primary_cursor` shortcuts
always send the analysis. Syntax and semantic spans are FlatBuffers structs, so the lists pack
without a table per span.

Measured with `bench_session` (40 join queries, 1880 syntax and 400 semantic spans, UTF-16 offsets):

| Event | Time, packed | Update size |
|---|---|---|
| Cursor move, host holds the analysis | 1.4 µs | 288 B |
| Cursor move, analysis included | 49 µs | 67 KB |
| Typed character, of which analysis is about 370 µs | 425 µs | 67 KB |

For a resolved reference under the cursor, `primary_cursor_context` names the entry that declares the
table (`declaration_catalog_entry_id`) and, for a script, the declaration in it
(`declaration_location`: the column definition, else the table name). The span is in UTF-8 bytes of
that script, not in the offset unit of the session. A descriptor has no location
(`script_session_test::cursor_context_names_the_descriptor_that_declares_the_table`).

## Completion's view of the catalog

`Completion` (`completion.rs`) reads the script's analysis (its own name index, scopes, CTEs and
resolved references) and the analysis's snapshot (the name indexes and declarations of all other
entries, tables by schema). `ScriptView::catalog()` returns that snapshot, or the catalog's current
snapshot for a script without analysis. Every location completion handles, from the analysis or
from a name index, refers to the same snapshot. The client function specs come from the same
snapshot, see [Completion](client_functions.md#completion).

The session refreshes an outdated analysis before it places the cursor, so editor completion sees
the current catalog. Completion on an outdated analysis through the `Script` API sees the catalog
as the analysis saw it.

## The relations of a connection

The relations of a connection are a descriptor entry with an id of its own (`catalogRelationEntryId`), and nothing else.
There is no script behind it. The rows of a metadata query become descriptor tables directly
(`catalogTablesFrom*`, `packCatalogDescriptor`, `catalog_sql_generator.ts`), so a refresh neither generates nor parses SQL.
The connection is the only source: a statement that ran is no statement about the connection, and
`create table if not exists t (a int)` on a `t(a, b)` still leaves `t(a, b)`.

**On disk** the relations are SQL, the one place where they are text. `generateRelationsFile` renders the descriptor
when a catalog update is saved. Restoring a connection parses the file once in the batch worker, publishes the descriptor
and drops the text (`connection_restore.ts`). `pack_catalog_descriptor` keeps the declaration order of the columns, the
analyzer sorts those of `CREATE TABLE` by name. The parser normalizes the spelling of types (`int8` is `bigint` after a
restore), the file doesn't change after that. A file `dashql-catalog-changes.sql` of older versions is cleared and the
connection refreshes on connect.

**After a successful statement** the app asks the connection:

1. The parser names the relation that a statement creates or drops (`touched_relations`,
   `packages/dashql-core-session/src/touched_relations.rs`). It doesn't analyze, and it names `CREATE TABLE`,
   `CREATE TABLE AS`, `CREATE VIEW`, `SELECT INTO`, `DROP TABLE` and `DROP VIEW`, temporary ones too.
2. The query executor runs this for every statement of the user that the backend ran, from a script or a shell
   (`RELATIONS_TOUCHED`). The defaults of the connection qualify the names into
   `CatalogUpdates.touchedRelations`.
3. The catalog loader takes them once no other update runs and the connection has room for another query
   (`CatalogUpdateVariant.RELATION_REFRESH`). A refresh that runs may have read the relations too early, the update
   follows it. A full refresh takes them as well, it reads the connection after the statements.
4. The metadata query of the connector reads these relations only, and `replace_tables` updates them: a relation with rows
   has a new table in the place of the old one, a relation without rows is gone. An answer that changes nothing keeps the
   catalog version. Salesforce has no such query and refreshes in full.

A failed lookup leaves the catalog as it is, the declarations of the scripts still resolve. A Hyper refresh that fails
for an attached database keeps the relations of that database (`CatalogTableUpdate.databases`).

Statements the parser doesn't know, such as `ALTER TABLE`, and changes made outside of DashQL need a manual refresh.

The standalone shell runs on an embedded database without a connection state. It reads the relations of its user
schemas after a statement that may have changed them, a statement that doesn't parse counts, and replaces its descriptor
before the prompt returns (`embedded_database_catalog.ts`).

**Copy-on-write.** `replace_tables` builds a new entry next to the old one, a published entry never changes. An analysis
reads its locations through its snapshot, which keeps the old entry alive, so tables may move in the new entry. The entry is
the unit of the copy: a connection is one entry, an update of one table unpacks, packs and imports all of its tables.
Measured on a release build with 20 columns per table, on the main thread:

| Tables | Build a descriptor from rows | Import | `replace_tables` of one table | Without a change |
|---|---|---|---|---|
| 1,000 | 22 ms | 20 ms | 20 ms | 4 ms |
| 10,000 | 287 ms | 135 ms | 228 ms | 34 ms |

## Wasm boundary and app

**Ownership** (`packages/dashql-core-wasm/src/lib.rs`)
- The JS `Catalog` wraps a `SharedCatalog`, the only shared catalog of the Rust side. `Script`,
  `ScriptSession` and the shell's `Shell` handles clone it, so they can outlive the JS catalog object,
  and pass borrows of it into the core.
- Freeing a `Script`, `ScriptSession` or `Shell` only frees memory, the app drops their catalog entries
  explicitly.
- All catalogs of a module share one `EntryIdSource`, so an entry id identifies a script across
  catalogs of the same module. The app runs three core modules (main thread, batch worker, shell),
  each with its own id space.
- `SessionPlanRequest` + `planSession()` borrow every session and every catalog for one planning call.

**JS caches** (`packages/dashql-core-js/src/api.ts`)
- `DashQLCatalog.flatten()` returns a `DashQLFlatCatalog`, cached for the version of the catalog
  (`Catalog.version`). Publishes and drops made through sessions, scripts or the shell bump the
  version, so the next call flattens again. It isn't a `CatalogSnapshot`: it merges the entries into
  one read-only view for the catalog tree and the name index.
- `DashQLScriptSession` keeps the latest update that carries an analysis, sets `known_analysis` on
  every event it applies, and fills an update with `analysis_omitted` from the arrays of that update.
  An unchanged analysis therefore keeps its array identity: the decoration fields and the gutter of
  the editor compare the arrays they read, so a cursor move rebuilds only the focus decorations.

**App flow per keystroke** (`packages/dashql-app/src/session/scripts/session_scripts.ts`)
1. The CodeMirror processor sends an `EditorEvent` with `analyze = true`; the session applies and
   analyzes.
2. `UPDATE_FROM_PROCESSOR`: if the text or analysis changed, derive annotations (compile), then
   `loadIntoCatalog()`, which publishes into the session layer.
3. Only if that publish changed the catalog revision, `markOtherScriptsOutdatedInPlace` flags the other
   scripts of the same connection catalog.
4. `script_editor.tsx` analyzes flagged scripts: the selected one immediately, others after
   `BACKGROUND_ANALYSIS_DELAY_MS`, through `analyzeScriptData` (analyze, compile, `loadIntoCatalog`).
   If that publish changes the catalog revision, e.g. a view over a table whose columns changed
   (`CREATE VIEW v AS SELECT * FROM a`), the other scripts are flagged again.

A failed analysis stays on the script as an update without available analysis, and the script is no
longer flagged: the same text against the same catalog fails again. A reducer that throws anyway is
logged and dropped by the session-scripts dispatch, and `UpdateQueue.flush` skips a throwing update
so the rest of the batch applies.

**Lazy analysis.** Restoring a session loads script text only; scripts stay outdated until first
use. Connection catalogs are restored and published before sessions open. Executions (feed, details,
commands) go through `ensureSessionScriptAnalyzed` (`session_scripts_registry.tsx`), and mounted editors
analyze as in step 4. Passive rendering never analyzes. `CATALOG_DID_UPDATE` marks the scripts of that
connection outdated; a native reload that adds, removes, moves or changes any script marks every script
of the session outdated.

**Planning and execution** (`session_execution.ts`, and `script_run.ts` for a run of one script)
analyzes and publishes every script, re-analyzes them at the final catalog version, then calls
`planSession()`. The planner reads the published declarations and the inputs, and flags a relation whose
published kind (`TableDeclaration.is_view`) differs from the input. A connection of the plan names its default
database and schema, statements on `t` and `db.schema.t` are ordered as one relation.

## Invariants

1. Published entries are immutable; replacing one never changes analyses that hold the old version.
2. An analysis never resolves against its own published entry.
3. Dependencies and catalog entries hold declarations, never analyses.
4. The catalog locations of an analysis are resolved through the snapshot it was analyzed against.
5. The catalog version changes whenever what other entries resolve against may have changed, and only
   then (except descriptors, which compare bytes: a different encoding of the same schema bumps).
6. Database and schema ids are canonical per catalog and never reused.

## Known gaps

- **Full rebuild on change.** A publish that changes declarations clones the entry maps and rebuilds
  every global index, O(all entries).
- **Analysis side effect.** Id reservations go through `RefCell<IdReservations>` behind `&Catalog`.
  Snapshots are `Sync`, the catalog itself is not.
- **Script table versions.** Script tables carry `catalog_version = 0`, so `referenced_catalog_version`
  of references to script tables is 0.

## Code map

| Concern | File |
|---|---|
| Ids | `packages/dashql-core/src/catalog/ids.rs` |
| Entry data, names, declarations, `same_declarations` | `packages/dashql-core/src/catalog/entry.rs` |
| Catalog, snapshots, publishing, resolution, flatten | `packages/dashql-core/src/catalog/mod.rs` |
| Descriptors | `packages/dashql-core/src/catalog/descriptor.rs` |
| Client function specs | `packages/dashql-core/src/catalog/clfn.rs` |
| Name search index | `packages/dashql-core/src/catalog/names.rs` |
| The relations that statements touch | `packages/dashql-core-session/src/touched_relations.rs` |
| The relations of a connection | `packages/dashql-app/src/connections/catalog/catalog_loader.tsx`, `catalog_sql_generator.ts`, `replace_tables` in `catalog/mod.rs` |
| Analyzer entry point, `AnalyzedScript` | `packages/dashql-core/src/analyzer/mod.rs` |
| Shared pass state | `packages/dashql-core/src/analyzer/state.rs` |
| Name resolution, schema inference | `packages/dashql-core/src/analyzer/name_resolution.rs` |
| Analysis types | `packages/dashql-core/src/analyzer/types.rs` |
| Script pipeline | `packages/dashql-core/src/script.rs` |
| Editor session | `packages/dashql-core-session/src/script_session.rs` |
| Completion | `packages/dashql-core/src/completion.rs` |
| Planner | `packages/dashql-core-session/src/planner.rs` |
| Wasm boundary | `packages/dashql-core-wasm/src/lib.rs` |
| JS wrapper | `packages/dashql-core-js/src/api.ts` |
| App script state | `packages/dashql-app/src/session/scripts/session_scripts.ts` |
| Tests | `packages/dashql-core/tests/catalog_test.rs`, `catalog_descriptor_test.rs`, `packages/dashql-core-session/tests/script_session_test.rs` |
