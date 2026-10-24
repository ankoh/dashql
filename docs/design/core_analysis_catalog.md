# Analysis and Catalog

How the Rust core (`packages/dashql-core`) analyzes scripts, publishes their declarations into a
catalog, resolves names across catalog entries, and decides when an analysis is stale. It covers
the core types, the editor session on top of them, the wasm boundary, and the way the app drives
them.

## Overview

```
 text ──scan──▶ ScannedScript ──parse──▶ ParsedScript ──analyze(catalog)──▶ AnalyzedScript
                 Arc, immutable           Arc, immutable                      Arc, immutable
                                                                                   │
                                          load_script(analysis, rank) ◀────────────┘
                                                     │
 ┌───────────────────────────────── Catalog ─────────▼──────────────────────────────────┐
 │  script entries      (PublishedScript, Rank)         ← declarations of editor scripts │
 │  descriptor entries  Arc<DescriptorEntry>            ← schemas of connections         │
 │  global indexes      by rank, by schema, by (database, schema)                       │
 │  version             bumped when what other entries resolve against changes          │
 └───────────────────────────────────────────────────────────────────────────────────────┘
                                                     │
                     analyze(other script, catalog) ─┘  resolves names against all entries
                                                        except its own
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

## Identity

| Id | Type | Scope | Allocated by |
|---|---|---|---|
| Catalog id | `u64` | process | `NEXT_CATALOG_ID` on `Catalog::new` / `with_entry_ids`. An analysis records it (`AnalyzedScript.catalog_id`) and `load_scripts` rejects analyses of another catalog (`CATALOG_MISMATCH`). |
| Catalog entry id | `CatalogEntryId = u32` | an `EntryIdSource` | `Catalog::allocate_entry_id`, from `INITIAL_ENTRY_ID = 1`. Catalogs that share a source never hand out the same id. The wasm module shares one source across all its catalogs (`ENTRY_IDS` in `dashql-core-wasm`). |
| Database id | `u32` | catalog | Reserved by name on first use, from `INITIAL_DATABASE_ID = 256`. Never reused. |
| Schema id | `u32` | catalog | Reserved by (database, schema) on first use, from `INITIAL_SCHEMA_ID = 65536`. Never reused. |
| Table / function id | `ExternalObjectId { origin, object }` | entry | `origin` is the declaring entry, `object` its index in the entry's declarations. |
| Column id | (table id, column index) | table | Index in `TableDeclaration.table_columns`. |
| Name id | `NameId = u32` | entry | Index in the name registry of the declaring script or descriptor. |

`QualifiedCatalogObjectId` (`catalog/ids.rs`) packs any of these into (type, u64, u32): database,
schema (database id, schema id), table (packed `ExternalObjectId`), column (packed table id, column
index), function. These are the ids the boundary exposes (semantic spans, completion candidates,
flat catalog).

**Consequences**
- Table and column ids are positional. Inserting a table before another one in a script changes the
  id of the later one.
- Database and schema ids are reserved through `&Catalog` (`RefCell<IdReservations>`), so analysis
  has a side effect on the catalog even though it borrows it immutably. Reservations survive drops
  and `clear`.

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
| `table_declarations` | `TableDeclaration`: object id, schema id, qualified name, columns, `is_view`, AST positions in the declaring script |
| `function_declarations` | `FunctionDeclaration`: object id, schema id, name, params, return type, aggregate flag |
| `tables_by_qualified_name`, `tables_by_unqualified_name`, `tables_by_unqualified_schema` | Table lookups: exact, by name, by (schema, database) range |
| `table_columns_by_name` | Columns by name across all tables of the entry |
| `functions_by_*` | Function lookups |
| `catalog_version` | The catalog version the entry was created against |

Names are `Name { entry, id, text: Arc<str> }`. The text is shared, so a qualified name copied from
another entry stays valid without borrowing that entry's name registry.

**Script entries** are produced by the analyzer from `CREATE TABLE`, `CREATE TABLE AS`,
`CREATE VIEW`, `SELECT INTO` and `CREATE FUNCTION`. Derived tables (`AS SELECT`) get their columns
from the output columns of the defining scope.

**Descriptor entries** (`catalog/descriptor.rs`) import a `CatalogDescriptor` FlatBuffer: validated
(`validate_descriptor`), then registered name by name. They keep their bytes
(`DescriptorEntry.bytes`) as the source for `apply_catalog_changes`. Their tables carry
`catalog_version = version + 1`, the version they are published with. Script tables carry 0.

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
    id: u64,
    version: CatalogVersion,
    entries: HashMap<CatalogEntryId, CatalogEntryRef>,
    script_entries: HashMap<CatalogEntryId, (PublishedScript, Rank)>,
    descriptor_entries: HashMap<CatalogEntryId, Arc<DescriptorEntry>>,
    entries_ranked: BTreeSet<(Rank, CatalogEntryId)>,
    entries_by_qualified_schema: BTreeMap<(db, schema, Rank, CatalogEntryId), SchemaEntryInfo>,
    entries_by_schema: BTreeMap<(schema, Rank, CatalogEntryId), SchemaEntryInfo>,
    databases: BTreeMap<db, Arc<DatabaseDeclaration>>,
    schemas: BTreeMap<(db, schema), Arc<SchemaDeclaration>>,
    ids: RefCell<IdReservations>,
    entry_ids: EntryIdSource,
}
```

**Ranks.** Every entry has a `Rank`; a lower rank wins on name conflicts, in resolution and in
`flatten`. The app publishes editor scripts with their script key as rank and connection descriptors
with a large constant, so session scripts shadow connection tables.

### Operations and versions

`version` starts at 1. It is the invalidation signal for everything that resolved against the
catalog, so it only moves when what other entries resolve against may have changed.

| Operation | Effect | Version |
|---|---|---|
| `load_script` / `load_scripts` | Publish analyses atomically. Validates catalog id, entry id collisions and canonical ids (`CATALOG_ID_OUT_OF_SYNC`). | **Unchanged** if every analysis replaces a published script with the same rank and `CatalogEntryData::same_declarations`; the entries are swapped in place. Otherwise +1 and all indexes are rebuilt. |
| `drop_script` | Remove a script entry and its index entries. | +1 if the entry existed |
| `replace_descriptor` | Import descriptor bytes and publish them. | +1 |
| `drop_descriptor` | Remove a descriptor. | +1 if it existed |
| `apply_catalog_changes` | Unpack the descriptor, apply the changes, replace it. | +1 |
| `clear` | Remove all entries (id reservations stay). | +1 |

`same_declarations` compares what other entries resolve against: the ids and names of databases,
schemas, tables, columns and functions, plus column order, function params and return types. It
ignores AST positions and name ids, which only the declaring script reads. So typing in a query of
a script that also declares tables republishes without a version bump, while adding a column, renaming
a table or changing the rank bumps it.

A rebuilding publish stages new maps and swaps them in at the end, so a failed publish leaves the
catalog unchanged.

### Resolution

`Catalog::resolve_table(name, ignore_entry, out, limit)` (`catalog/mod.rs`):

| Name | Strategy |
|---|---|
| `db.schema.table` | Exact lookup in the entries of (db, schema), in rank order. A direct hit wins. |
| `schema.table` | Entries that populate the schema in any database, by rank. |
| `table` | All entries by rank, by unqualified name. |

`ignore_entry` is the analyzing script's own entry id: a script resolves its own declarations from
its in-progress analysis, never from its published version. Further matches up to `limit` are kept as
alternatives for ambiguity errors.

## Analysis

`analyze(parsed, catalog)` (`analyzer/mod.rs`) runs four passes over the post-order AST, interleaved
in morsels of 1024 nodes so that expression ids come out in a fixed order:

| # | Pass | Output |
|---|---|---|
| 1 | Name resolution (`name_resolution.rs`) | Scopes, table and column references, declarations, inferred schemas |
| 2 | Function calls (`function_calls.rs`) | Function call expressions and their arguments |
| 3 | Constant propagation (`constants.rs`) | Constant expression roots |
| 4 | Visualizations (`visualization.rs`) | `VisualizationSpec`s of `VISUALIZE` statements |

All passes share `AnalysisState` (`analyzer/state.rs`): the parsed script, the catalog, the name
texts, the output `AnalyzedScript`, and `expression_index` (AST node → expression), through which
later passes find what earlier ones produced. The output is a set of flat arenas indexed by `u32`
ids (`expressions`, `table_references`, `name_scopes`, `function_arguments`, …) with id-based links
between them.

### Name resolution

During the AST scan the pass collects table refs, column refs, result targets, CTEs and column
definitions per node and merges them upward. At scope roots (`SELECT`, `VISUALIZE`, `CREATE`) it
creates a `NameScope` and links it to its parent. Declarations are registered as they are visited:
`register_schema` reserves the database and schema ids and adds the references to the script's own
`CatalogEntryData`.

`finish` then:
1. indexes the script's declarations (`index_declarations`)
2. resolves names in three sweeps over the scope tree: bottom-up (tables against CTEs, the script and
   the catalog; columns against the tables and child outputs of the scope), top-down (correlated
   references from parent scopes), then unresolved tables against the remaining candidates
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

### Dependencies

A `TableLoc` into another entry is only meaningful against that entry's declarations as they were
at analysis time. The catalog can replace or drop the entry later, so the analysis keeps them:

```rust
pub dependencies: Vec<Arc<CatalogEntryData>>  // every published entry except its own, at analysis time
```

`AnalyzedScript::table(loc)` resolves through the script's own entry, then the dependencies.
Encoding (`pack.rs`) and completion use it for every location that came out of the analysis.

The dependencies and the catalog hold **declarations only**, never analyses. An analysis holds
dependencies of its own; if dependencies or catalog entries held analyses, two scripts that reference
each other and are published in turn would form an unbounded chain A₃ → B₂ → A₂ → B₁ → …, keeping
every earlier version of both alive. `CatalogEntryData` owns no analysis, so the chain stops after
one level (`catalog_test::republished_scripts_do_not_retain_earlier_versions`,
`catalog_test::published_scripts_do_not_retain_their_analysis`).

### What an analysis records about the catalog

| Field | Use |
|---|---|
| `catalog_id` | Publishing into the wrong catalog fails |
| `entry.catalog_version` | The catalog version it resolved against. Session and planner treat the analysis as current only if it equals the catalog's version. |
| `dependencies` | Declarations behind its cross-entry locations |
| Resolved ids in table and column refs | Exposed to the editor (semantic spans, cursor context) with `referenced_catalog_version` |

## Staleness

An analysis is current when nothing it read has changed. Three counters exist:

| Counter | Owner | Bumped by |
|---|---|---|
| `text_version: u64` | `Script` | Every committed text edit |
| `catalog.version: u32` | `Catalog` | See [Operations and versions](#operations-and-versions) |
| `state_revision: u64` | `ScriptSession` | Every committed change of text, selection or analysis; the editor reconciles by it |

`ScriptSession::is_analysis_current` (`script_session.rs`) requires:
- the analyzed text version and the parsed/scanned snapshots match the current text
  (`Arc::ptr_eq` along the chain)
- the session's recorded catalog revision equals the catalog version
- `analyzed.entry.catalog_version` equals the catalog version

The planner applies the same catalog check per input (`planner.rs`, "stale catalog analysis").

### Editing a published script

A text edit does **not** remove the script from the catalog. Other scripts keep resolving against
its last published declarations until the owner publishes the new analysis, and the analysis of the
edited script ignores its own entry (`ignore_entry` in resolution, own-id filter in completion and
dependencies). With equal declarations, the republish leaves the version unchanged, and no other
analysis goes stale.

A publish that does bump the version makes the publishing script's own analysis stale too: its
`entry.catalog_version` is now older than the catalog. The next `analyze` re-analyzes it against the
new version, and republishing that analysis is a no-op. So the system converges after one extra
analysis per declaration change.

## Editor session

`ScriptSession` (`script_session.rs`) owns one `Script` and shares the catalog as
`CatalogHandle = Rc<RefCell<Catalog>>`. It borrows the catalog only for the duration of a call.

| Call | Catalog effect |
|---|---|
| `apply(event)` | None; analyzes if `event.analyze` or if a selection change meets a stale analysis |
| `analyze()` | None; re-analyzes if not current |
| `load_into_catalog(rank)` | `load_script`; records the resulting catalog version |
| `drop_from_catalog()` | `drop_script` |
| `Drop` | `drop_script` through `try_borrow_mut`; **silently skipped** if the catalog is borrowed at that moment |

Every update carries `catalog_revision` and `analysis_available`; the full projection (diagnostics,
syntax and semantic spans, cursor, annotations, statistics) is included only when the analysis is
current.

## Completion's view of the catalog

`Completion` (`completion.rs`) reads three sources:

| Source | What | Lookup |
|---|---|---|
| The script's analysis | Its own name index, scopes, CTEs, resolved references | `AnalyzedScript::table` (own entry, then dependencies) |
| The live catalog | Name indexes of all entries except the script's own id, tables by schema | `Catalog::entry`, current declarations |
| Combined | Candidates for unresolved columns (tables that have such a column) | Live catalog, then the own entry |

Candidates found in the live catalog are looked up in the live catalog; locations that came out of
the analysis are looked up through the analysis. Mixing the two would index declarations of one
version with locations of another.

## Descriptors and catalog changes

Connections publish their schema as descriptor entries:
- `replace_descriptor(id, rank, bytes)` imports a full schema (from a batch: metadata → catalog SQL →
  `process_batch` in a worker → descriptor bytes).
- `apply_catalog_changes(id, rank, changes)` follows the DDL the user runs, without a full refresh.

`catalog/changes.rs`:
1. `derive_catalog_change(analysis, statement)`: a successful `CREATE TABLE`, `CREATE TABLE AS`,
   `CREATE VIEW`, `SELECT INTO` or `DROP` becomes a `CatalogChangeT`, with the relation named as written
   and the columns from the analysis.
2. `qualify_catalog_changes(changes, defaults)`: qualifies names with the connection's default
   database and schema.
3. `compact_catalog_changes`: keeps the last change of every relation. `IF NOT EXISTS` is resolved
   against the earlier changes: after a creation it changes nothing, after a drop it creates
   unconditionally.
4. `apply_catalog_changes`: unpack the descriptor bytes, apply, pack, `replace_descriptor`.
5. `render_catalog_changes_sql` / `parse_catalog_changes_sql` / `append_catalog_changes_sql`: the changes
   of a connection persist as a SQL script of `CREATE TABLE` / `DROP TABLE` statements under the header
   `-- Catalog changes of executed statements`. Parsing runs the script through a throwaway catalog and
   the normal derivation.

`ScriptExecution` derives the change of every compiled statement up front and emits it with the
statement's successful result.

## Wasm boundary and app

**Ownership** (`packages/dashql-core-wasm/src/lib.rs`)
- The JS `Catalog` wraps a `CatalogHandle`. `Script` and `ScriptSession` handles clone it, so they can
  outlive the JS catalog object.
- All catalogs of a module share one `EntryIdSource`, so an entry id identifies a script across
  catalogs of the same module. The app runs three core modules (main thread, batch worker, shell),
  each with its own id space.
- `SessionList` + `plan()` borrow every session and its catalog for one planning call.

**JS caches** (`packages/dashql-core-js/src/api.ts`)
- `DashQLCatalog` caches a `flatten()` snapshot and clears it only on catalog calls made through the
  wrapper. Publishes and drops made through sessions, scripts or the shell do not clear it
  (`createUncachedSnapshot` bypasses the cache).

**App flow per keystroke** (`packages/dashql-app/src/app/session/scripts/session_scripts.ts`)
1. The CodeMirror processor sends an `EditorEvent` with `analyze = true`; the session applies and
   analyzes.
2. `UPDATE_FROM_PROCESSOR`: if the text or analysis changed, derive annotations (compile), then
   `loadIntoCatalog(scriptKey)`.
3. Only if that publish changed the catalog revision, `markOtherScriptsOutdatedInPlace` flags the other
   scripts of the same connection catalog.
4. `script_editor.tsx` analyzes flagged scripts: the selected one immediately, others after
   `BACKGROUND_ANALYSIS_DELAY_MS`, through `analyzeScriptData` (analyze, compile, `loadIntoCatalog`).

**Planning and execution** (`session_execution.ts`) analyzes and publishes every script, re-analyzes
them at the final catalog version, then calls `plan()`. The planner reads the published
declarations and the inputs, and flags a relation whose published kind (`TableDeclaration.is_view`)
differs from the input.

## Invariants

1. Published entries are immutable; replacing one never changes analyses that hold the old version.
2. An analysis never resolves against its own published entry.
3. Dependencies and catalog entries hold declarations, never analyses.
4. A location from an analysis is resolved through that analysis; a location from the live catalog
   through the live catalog.
5. The catalog version changes whenever what other entries resolve against may have changed, and only
   then (except `replace_descriptor` and `apply_catalog_changes`, which always bump).
6. Database and schema ids are canonical per catalog and never reused.

## Known gaps

- **Full rebuild on change.** A publish that changes declarations clones the entry maps and rebuilds
  every global index, O(all entries).
- **Analysis side effect.** Id reservations go through `RefCell<IdReservations>` behind `&Catalog`,
  which also makes `Catalog` `!Sync`.
- **Over-broad dependencies.** They are all published entries, not just the ones the analysis
  resolved against.
- **Cascades.** `analyzeScriptData` republishes without marking other scripts outdated. A script whose
  declarations depend on another (`CREATE VIEW v AS SELECT * FROM a`) can bump the version without
  propagating.
- **DDL during planned execution.** Statements run through planned session execution do not apply
  their catalog changes; only the single-script `ScriptExecution` path does.
- **Silent drop failure.** `ScriptSession`'s `Drop` silently skips removing its entry if the catalog
  is borrowed.
- **Script table versions.** Script tables carry `catalog_version = 0`, so `referenced_catalog_version`
  of references to script tables is 0.
- **Descriptor republish.** `replace_descriptor` bumps the version even for identical bytes.

## Code map

| Concern | File |
|---|---|
| Ids | `packages/dashql-core/src/catalog/ids.rs` |
| Entry data, names, declarations, `same_declarations` | `packages/dashql-core/src/catalog/entry.rs` |
| Catalog, publishing, resolution, flatten | `packages/dashql-core/src/catalog/mod.rs` |
| Descriptors | `packages/dashql-core/src/catalog/descriptor.rs` |
| Name search index | `packages/dashql-core/src/catalog/names.rs` |
| Catalog changes | `packages/dashql-core/src/catalog/changes.rs` |
| Analyzer entry point, `AnalyzedScript` | `packages/dashql-core/src/analyzer/mod.rs` |
| Shared pass state, dependencies | `packages/dashql-core/src/analyzer/state.rs` |
| Name resolution, schema inference | `packages/dashql-core/src/analyzer/name_resolution.rs` |
| Analysis types | `packages/dashql-core/src/analyzer/types.rs` |
| Script pipeline | `packages/dashql-core/src/script.rs` |
| Editor session | `packages/dashql-core/src/script_session.rs` |
| Completion | `packages/dashql-core/src/completion.rs` |
| Planner | `packages/dashql-core/src/planner.rs` |
| Wasm boundary | `packages/dashql-core-wasm/src/lib.rs` |
| JS wrapper | `packages/dashql-core-js/src/api.ts` |
| App script state | `packages/dashql-app/src/app/session/scripts/session_scripts.ts` |
| Tests | `packages/dashql-core/tests/catalog_test.rs`, `script_session_test.rs` |
