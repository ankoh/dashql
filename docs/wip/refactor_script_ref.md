# Follow-up: Collapse `SCRIPT_REFERENCE` vs `TABLE_REFERENCE`

## Context

A `VISUALIZE` statement can draw its data from three kinds of source, tracked by the
`VisSourceKind` enum in `proto/fb/dashql/analyzed_script.fbs`:

- `INLINE_SELECT` — a `(SELECT ...)` subquery written inline in the `VISUALIZE`.
- `TABLE_REFERENCE` — a reference to a real catalog table (e.g. a Hyper/Salesforce table).
- `SCRIPT_REFERENCE` — a reference to another notebook script's output, addressed as
  `dashql.script."<folder>/<file>"`.

The last two both originate from the *same* AST case (`OBJECT_SQL_TABLEREF`). The analyzer splits
them into two enum values purely by matching the qualified name prefix
(`analyze_visualization_pass.cc`):

```cpp
bool is_script_ref = rel->table_name.database_name.get().text == "dashql" &&
                      rel->table_name.schema_name.get().text == "script";
spec.resolved_source.kind =
    is_script_ref ? VisSourceKind::ScriptReference : VisSourceKind::TableReference;
```

TypeScript then dispatches on the enum in `visualize_executor.ts` to build the executable SQL:

- `SCRIPT_REFERENCE` → look up the *producing script's text* and inline it, because the
  `dashql.script.*` tables are synthetic — they exist only in dashql's catalog, so Hyper cannot
  query them directly.
- `TABLE_REFERENCE` → emit `SELECT * FROM db.schema.table`, because that table is real.

## Why the split is now potentially redundant

The recent catalog-based resolution change (see the
`project_script_ref_catalog_resolution` memory) added `source_resolved_table_id` to the spec. It is
packed as `(catalog_entry_id << 32) | table_index`, so the upper 32 bits are the producing entry's
`catalog_entry_id`, which for a notebook script equals its `scriptKey`.

That means the two branches no longer need the enum to tell them apart. They can be distinguished at
the point of use by the resolved id itself:

- A `dashql.script` synthetic table resolves to a **notebook script's entry**, so its `scriptKey`
  is present in `state.scripts` → inline that script's text.
- A real catalog table resolves to an entry that is **not** a notebook script, so its id is absent
  from `state.scripts` → `SELECT * FROM` the qualified name.

So in principle we could drop `SCRIPT_REFERENCE` entirely, keep a single `TABLE_REFERENCE` kind, and
disambiguate in TS by "did the resolved id land on a known notebook script?".

## Why this was deferred

1. **Cross-language proto/enum churn.** Removing an enum value ripples through the C++ pass, the
   `.fbs`, the regenerated C++/TS bindings, and every `switch` on `VisSourceKind`. Larger blast
   radius than the rename bug it would ride along with.
2. **The name-based split may be meaningful semantics, not just plumbing.** "This VISUALIZE
   references another notebook script" vs "references an external table" is a distinction the UI or
   future rename/dependency logic might legitimately want *without* resolving an id — notably when
   the source script has an error and the resolved id is `0`/unresolved, in which case the id can no
   longer carry the distinction but the name prefix still can.
3. **Risk vs. reward.** The simplification is small, and collapsing the cases is exactly the kind of
   change that can quietly break the unresolved-source and external-table paths.

## Decision

Deferred, and possibly *not worth doing*. Revisit only if:

- We want to keep the dependency edge (script A → script B) resolvable when the source has an error,
  in which case we should **keep** the name-based `SCRIPT_REFERENCE` and treat the id purely as an
  optimization; **or**
- We're already touching `VisSourceKind` for another reason and can fold the cleanup in cheaply.

If we do proceed, the id-present-in-`state.scripts` check is the disambiguator, and the name prefix
match in `analyze_visualization_pass.cc` becomes dead code that can be removed alongside the enum
value.

## Related

- `project_script_ref_catalog_resolution` memory — the completed catalog-based resolution work this
  follows from.
- `packages/dashql-core/src/analyzer/analyze_visualization_pass.cc` — the name-prefix split.
- `packages/dashql-app/src/connection/visualize_executor.ts` — the TS dispatch on `VisSourceKind`.
