# Core Catalog

The catalog is the central metadata registry that stores schema information (databases, schemas, tables, columns, functions) and makes it available for name resolution, completion, and the frontend.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Catalog                             │
│                                                              │
│  entries: map<CatalogEntryID, CatalogEntry*>                 │
│  entries_ranked: set<(Rank, CatalogEntryID)>                 │
│  entries_by_schema: map<(schema, rank, id), Info>            │
│  entries_by_qualified_schema: map<(db, schema, rank, id)>    │
│                                                              │
│  databases: map<name, DatabaseDeclaration>                   │
│  schemas: map<(db, schema), SchemaDeclaration>               │
│                                                              │
│  version: uint32  (bumped on every mutation)                 │
└──────────────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐      ┌─────────────────┐
│  CatalogEntry   │      │  CatalogEntry   │
│ (AnalyzedScript)│      │ (AnalyzedScript)│
│                 │      │                 │
│  tables         │      │  tables         │
│  columns        │      │  columns        │
│  functions      │      │  functions      │
│  indexes...     │      │  indexes...     │
└─────────────────┘      └─────────────────┘
```

Each `CatalogEntry` is backed by an `AnalyzedScript` and maintains its own local indexes for tables, columns, and functions. The `Catalog` maintains global indexes over all entries, organized by rank.

## Catalog IDs

### CatalogEntryID (`uint32_t`)

Every `Script` receives a unique entry ID on construction:

```cpp
Script::Script(Catalog& catalog)
    : catalog(catalog), catalog_entry_id(catalog.AllocateEntryId()), text(1024) {}
```

IDs start at `INITIAL_ENTRY_ID = 1` and increment. Allocation skips any IDs already in use. This ID is stable for the lifetime of the script and propagates through all processing stages (scan, parse, analyze).

### ExternalObjectID (Tables and Functions)

Tables and functions are identified by a 64-bit packed ID combining the owning entry ID and the object's index within that entry:

```
┌─────────────────────────────────────────────────────────────────┐
│  ExternalObjectID (64 bits)                                     │
├────────────────────────────────┬────────────────────────────────┤
│  origin: CatalogEntryID (32b)  │  value: object_index (32b)     │
└────────────────────────────────┴────────────────────────────────┘
```

For example, table #3 in the entry with ID 5 has `ExternalObjectID(5, 3)`. This encoding allows resolving any table ID back to its owning entry with a single map lookup on the origin.

### QualifiedCatalogObjectID

A tagged union that identifies any catalog object by type and position in the hierarchy:

| Type | Layout |
|------|--------|
| `Database` | `(type=1, part0=database_id, part1=0)` |
| `Schema` | `(type=2, part0=database_id, part1=schema_id)` |
| `Table` | `(type=3, part0=ExternalObjectID.Pack(), part1=0)` |
| `TableColumn` | `(type=4, part0=ExternalObjectID.Pack(), part1=column_index)` |
| `Function` | `(type=5, part0=ExternalObjectID.Pack(), part1=0)` |

Database IDs start at `INITIAL_DATABASE_ID = 256`, schema IDs at `INITIAL_SCHEMA_ID = 65536`. These are allocated by the catalog on first reference and reused if the same name appears in multiple entries.

## Interaction with Analyzed Scripts

### Lifecycle

```
Script(catalog)                    ← allocates CatalogEntryID
    │
    ▼
Script::Scan()                     ← tokenizes, builds name registry
    │
    ▼
Script::Parse()                    ← produces AST
    │
    ▼
Script::Analyze()                  ← creates AnalyzedScript (a CatalogEntry)
    │                                 name resolution populates tables/functions
    ▼
Catalog::LoadScript(script, rank)  ← registers entry in catalog indexes
```

### Analysis: Populating the CatalogEntry

The `AnalyzedScript` constructor inherits from `CatalogEntry` using the same ID that was assigned to the script:

```cpp
AnalyzedScript::AnalyzedScript(std::shared_ptr<ParsedScript> parsed, Catalog& catalog)
    : CatalogEntry(catalog, parsed->external_id), ...
```

During the name resolution pass, `CREATE TABLE` and `CREATE FUNCTION` statements populate the entry:

1. **Schema registration** — The pass calls `RegisterSchema(database_name, schema_name)` which allocates a `CatalogDatabaseID` and `CatalogSchemaID` via the catalog (reusing existing IDs for known names).

2. **Table ID allocation** — A new `ExternalObjectID` is constructed from the entry's own ID and the current table count: `ExternalObjectID{catalog_entry_id, table_declarations.GetSize()}`.

3. **Table declaration** — A `TableDeclaration` is created with its schema reference, table ID, qualified name, and column list. Columns receive `QualifiedCatalogObjectID::TableColumn(table_id, column_index)` IDs.

4. **Index construction** — During `Finish()`, the pass builds lookup indexes on the entry:
   - `tables_by_qualified_name` — exact `(db, schema, table)` lookup
   - `tables_by_unqualified_name` — multimap by table name alone
   - `tables_by_unqualified_schema` — btree by `(schema, db)` for prefix search
   - `table_columns_by_name` — multimap for column name search across all tables

### Loading into the Catalog

`Catalog::LoadScript(script, rank)` registers the analyzed script's entry in the catalog:

1. **ID collision check** — Fails if another entry already uses this ID.
2. **Schema ID sync check** — Verifies that any database/schema names in this entry have the same IDs as already-registered names. If there's a mismatch (possible when entries are analyzed before loading), loading fails with `CATALOG_ID_OUT_OF_SYNC`.
3. **Database/schema registration** — Inserts new database and schema declarations into the catalog's global registries.
4. **Schema index registration** — Adds the entry to `entries_by_qualified_schema` and `entries_by_schema` for all schemas it references.
5. **Version bump** — Increments the catalog version.

### Updating and Dropping

When a script is re-analyzed and reloaded, `UpdateScript` computes a diff of database/schema names and updates indexes incrementally. Schemas that no longer exist are removed from catalog indexes; new schemas are registered. This operates in `O(databases + schemas)`, independent of table/column count.

`DropScript` removes all schema index entries and the entry registration. The `Script` destructor calls `DropScript` automatically.

## Resolution

### Table Resolution

Resolution supports multiple qualification levels:

| Input | Strategy |
|-------|----------|
| `db.schema.table` | Direct lookup in `tables_by_qualified_name` |
| `schema.table` | Search all entries via `entries_by_schema` index |
| `table` | Scan all entries in rank order via `tables_by_unqualified_name` |

The own entry is always checked first (the script may reference tables it defines but hasn't loaded into the catalog yet). Then the catalog is searched in rank order.

### Cross-Entry Resolution

During name resolution, table references resolve by:
1. Checking CTEs in the current and parent scopes
2. Calling `analyzed->ResolveTable(name)` to search the own entry
3. Calling `catalog.ResolveTable(name, own_entry_id, ...)` to search all other entries

The catalog searches entries in rank order. Lower rank = higher priority. The first match wins; additional matches are stored as alternatives for ambiguity reporting.

## Rank System

Each loaded entry has a rank (`uint32_t`). When multiple entries define the same table name, the entry with the lowest rank takes precedence. This is used during:
- Table name resolution (lower rank wins)
- Flat catalog generation (duplicate tables from higher-rank entries are skipped)
- Schema table enumeration for completion

## Flat Catalog (Frontend Serialization)

`Catalog::Flatten()` produces a `FlatCatalog` FlatBuffer optimized for the frontend:

```
FlatCatalog
├── name_dictionary: [string]       ← shared string pool
├── databases: [FlatCatalogEntry]   ← flat array, children = schemas
├── schemas: [FlatCatalogEntry]     ← flat array, children = tables
├── tables: [FlatCatalogEntry]      ← flat array, children = columns
├── columns: [FlatCatalogEntry]     ← flat array, leaf nodes
├── databases_by_id: [IndexedFlatDatabaseEntry]  ← sorted for binary search
├── schemas_by_id: [IndexedFlatSchemaEntry]
└── tables_by_id: [IndexedFlatTableEntry]
```

Each `FlatCatalogEntry` stores: `(flat_entry_idx, flat_parent_idx, catalog_object_id, name_id, child_begin, child_count)`. The name dictionary avoids redundant UTF-8→UTF-16 conversions in the virtualized frontend renderers.

Tables are deduplicated during flattening: entries are iterated in rank order and the first declaration of each `(schema, table_name)` pair wins.

## Versioning

The catalog maintains a monotonically increasing `version` counter. Every mutation (load, update, drop, clear) bumps it. The `AnalyzedScript` records the catalog version at creation time. This allows consumers to detect when the catalog has changed and cached resolution results may be stale.
