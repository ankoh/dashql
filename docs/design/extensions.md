# Extensions

An **extension** adds what DashQL needs for a service, in a folder of `extensions/`. Extensions are bundled with the app and declarative: nothing gets installed, and an extension runs no code of its own.

It holds two things so far:

- **[Client functions](client_functions.md)** let a script reach the REST API of the service with `CALL`.
- **[Snippets](#snippets)** show up in the snippet browser of the connections that can run them.

[Data 360](../../extensions/d360-api/clfn/docs/overview.md), in `extensions/d360-api/`, is the only extension so far.

## Layout

A folder is named for the API, which needn't equal the namespace of its client functions: `extensions/d360-api/` holds the client functions of `cdp`.

| Folder | Holds |
|---|---|
| `clfn/spec/` | The source of `spec.json`, or the file itself. Data 360 generates it from YAML, and the app bundles what Bazel generates |
| `clfn/tests/` | The tests of the spec and the snippets against the core |
| `clfn/docs/` | The reference documents |
| `snippets/` | The snippets, in folders. Data 360 has `functions/` with a snippet per function, `scenarios/` with workflows whose steps build on each other, and `zero-copy/` with a snippet per warehouse and way to read it |

## Bundling

`//packages/dashql-app:extensions` stages the `files` target of an extension for the `@dashql/extensions` alias, and the app finds what it needs there by path:

| Path | Read by |
|---|---|
| `<extension>/clfn/spec/spec.json` | `loadClientFunctionSpec` (`connections/clfn/clfn_specs.ts`), for the binding of a connector. Every spec is a chunk of its own, so a connection only loads it when it needs it |
| `<extension>/snippets/**/*.sql` | The snippet registry (`session/snippets/snippet_registry.ts`) |

## Snippets

An extension is a root of the snippet browser, listed in `SNIPPET_ROOT_CONNECTORS` (`session/snippets/snippet.ts`) with the connectors that run its snippets. A connector with several roots shows them as top-level folders: a Salesforce connection has `d360` with the SQL of `examples/snippets/d360`, and `d360-api`.

The snippets of an extension don't have to be reentrant, because an API has no `if not exists`, see [sql_scripts.md](../agents/sql_scripts.md).

## Adding an extension

1. Add a folder in `extensions/`, with a `files` target in its `BUILD.bazel`, and add that target to `//packages/dashql-app:extensions`.
2. For client functions, add a [spec](client_functions.md#the-spec), and a [binding](client_functions.md#connector-binding) on the descriptor of the connector.
3. For snippets, add the folder name to `SNIPPET_ROOT_CONNECTORS`.
