# Capabilities

DashQL extends SQL with comment tags and named parameters. A host that wants plain SQL, or only some of the
extensions, e.g. the console of a database service, lists the capabilities it offers. Without a list every capability
is offered, like in DashQL.

| Capability | What it offers | See |
|---|---|---|
| `params` | Named scalar parameters, `where amount > :min`, the inputs of a workbook, and their `@param :min = 10` tags | [workbook_inputs.md](workbook_inputs.md) |
| `table_parameters` | Named table parameters, `from :foo`: the results of other scripts and the attached files | [script_references.md](script_references.md) |
| `vis` | The visualizations of `@vis` tags, the compiler makes a VISUALIZE of a query with one | [vis_comments.md](vis_comments.md) |
| `board` | The dashboard placements of `@board` tags (and of `@vis board` and `@vis card` of older scripts) | [vis_comments.md](vis_comments.md) |
| `flow` | The dataflow positions of `@flow` tags (and of `@vis flow`) | [vis_comments.md](vis_comments.md) |
| `manual` | The scripts that run only on request, `@manual` tags | [planner.md](planner.md) |

Positional parameters (`$1`, `?`) are plain SQL and no capability.

## What a missing capability does

Parsing doesn't change, the scanner and the parser know every tag (`core_parser.md`, Comment Tags). The analyzer
reads what the catalog doesn't offer and flags it with a `DISABLED_CAPABILITY` diagnostic (`analyzer/capabilities.rs`):

- **A tag** is a warning on the name of the tag, `@vis is not available here, the tag is ignored`. The passes of the
  tags skip it: no visualization, no placement, no input value, the script is not manual. The statement runs like one
  with an ordinary comment. A Javadoc `@param x the x` names no parameter and stays quiet.
- **A named parameter** is an error of its statement, `the parameter :min is not available here`. A database doesn't
  know `:min` or `:foo`, so the planner stops at the error like at one of a client function call and doesn't run the
  statement.
- **Completion** offers no disabled tag after `@` and completes nothing in the content of a disabled tag.

## Where the capabilities live

`Capabilities` (`capabilities.rs` of the core) belongs to the catalog snapshot that a script is analyzed against
(`CatalogSnapshot::capabilities`, `Catalog::set_capabilities`). Every script of a connection sees the same, and an
analysis keeps the capabilities it was made with in its snapshot. A change bumps the version of the catalog, so the
analyses made before are no longer current and their next analysis sees the new capabilities.

- **The runtime** gives every connection the `capabilities` of its settings (`RuntimeSettings`, read once): a new
  connection, a restored one and one that an import creates (`ConnectionStateOptions::capabilities`).
- **A host** names them as a list, `settings: { capabilities: ['params', 'table_parameters'] }` of the platform of
  the runtime (`RuntimeCapability` of `@akohn/dashql`). An unknown name fails the creation of the runtime, a typo must
  not change what scripts may use.
- **A catalog outside a runtime**, e.g. of a session of its own, takes them with `DashQLCatalog.setCapabilities`.

## Tests

The analyzer and completion snapshots take an optional list, `capabilities: [vis, board]` of a case
(`capabilities_of` of `tests/snapshots/src/lib.rs`): a case without the key offers every capability, a case with it
only those it lists. The cases are `tests/snapshots/analyzer/capabilities.tpl.yaml` and
`tests/snapshots/completion/capabilities.tpl.yaml`. The planner test
`parameters_of_disabled_capabilities_stop_the_plan` checks the stop, `packages/dashql/src/core/capabilities.test.ts`
the bindings and the settings of a runtime.
