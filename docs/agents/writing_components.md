# Writing a component

A component of the app shows a model and the state of the user interface. The hooks of the runtime, the models and the
components that other hosts share are the package `@akohn/dashql-react` (`packages/dashql-react`): the building blocks
(buttons, overlays, inputs, tabs, the JSON view, ...) in `src/components` with their stylesheets, their helpers in
`src/dom`, imported as `@akohn/dashql-react/components/button` and `@akohn/dashql-react/dom/anchored_position`. The
largest is the data table (`components/data_table/data_table`, its entry module exports what a host uses): it shows a
computation model, takes the column header as a prop and the detail of a cell as a slot; the app wraps it in
`DataTableView` (`views/query_result/data_table_view.tsx`), which adds the column plots of the settings and its cell
overlay. The result of a query (`components/query_result`: header, panel, details, the card of the full table, the
search, the download, the action menu and the detail of a cell), the progress panel, the query profile, the profile of
a plan text (`query_profile/engine_profile_view`) and history views, the Vega-Lite chart and view
(`components/vegalite_view`, with the library in `vegalite/`) and the visualizations (`components/visualization`: the
Markdown view, the chart preview and download, the dispatch on the renderer and the panel with its header) are there
too; the app keeps containers of the same names that read the runtime and fill the slots. What a component needs of
the host besides a model comes in as props of the types in `host`: `CoreSetup` (the core module, e.g. to lay out a
plan) and `DownloadFile` (save a file of the user, the app passes `useDownloadFile`). A rule about SQL that a
component would need goes into the core and reaches the component through its container, e.g. the projection of the
columns of a result (`rewriteResultProjection` of a script session). The theme of a component follows `useColorScheme` of
`theme/color_scheme` and `useBrand` of `brand/brand`, which the host fills. A component shared there reaches neither the hooks nor the runtime of `@akohn/dashql`, a model only by type
(`//packages/dashql-react:boundary_test`); it logs through `useLogger` of `@akohn/dashql-react/logger`, whose context
the host provides. Their tests sit next to them (`button.test.tsx`) with the helpers of `src/testing` (`react_act`,
`ResizeObserverMock`); the browser tests of the app run them as `dashql-react/src/<path>`
(`//packages/dashql-react:browser_test_files`, `//packages/dashql-app:test_chromium`). A component doesn't talk to the
runtime: it knows no
view kinds, slices, targets, actions, commands or handles, and it doesn't need to know when the store flushes. Those
stay in the model hooks, one per thing that the app shows. The runtime itself is described in
[dashql_runtime.md](../design/dashql_runtime.md), read it when you change the runtime or a model.

## The layers

| Layer | Where | Knows |
|---|---|---|
| Components | `@akohn/dashql-react/components/...`, or the app, e.g. `workbook/feed/script_card.tsx` | A model, plain props, slots. No import of the runtime |
| Models | `@akohn/dashql-react/models/...` (`packages/dashql-react/src/models/`) | The views, the actions of a target, the commands of the facade, `settled` |
| Runtime | `@akohn/dashql/runtime`, the core module | Everything else |

A model is an interface with a hook that implements it over the runtime:

| Model | Shows | Operations |
|---|---|---|
| `useScriptModel` (`models/script_model`) | the script, its latest query, whether its workbook runs | `run`, `cancel`, `setText`, `acceptDiff`, `rejectDiff`, `setVisSpec` |
| `useQueryModel` (`models/query_model`) | the query, its progress, its result as an Arrow table; the profile while asked for | `cancel` |
| `useComputationModel` (`models/computation_model`) | the computation of a result table and the Arrow tables of its handles | `dispatch` of a computation action (filters, ordering, searches, summaries) |

Each has a fake in `@akohn/dashql-react/testing/fake_models`. An operation that changes state resolves once the
store shows the change (`settled` of the dispatch), and the component renders with a new model right after. A model is
the state of one render: the object a handler holds doesn't change after an `await`, the next render brings the new one.

A model binds and decides nothing. A decision that a model or a component would have to make about the runtime, e.g.
whether a cancel stops the run of the workbook or the query of a script, is a command or an action of the core instead
(`cancelScript`), see [core_first.md](core_first.md).

## Recipe

1. **Find the model** of what the component shows. If an operation is missing, add it to the interface and the hook. If
   the runtime has no action or command for it, add that first: an action of the union of its target in
   `packages/dashql-core-bindings/src/runtime/actions.rs`, or a command of the facade.
2. **Write the component** against the interface of the model and plain props. Group props by what they are: the place
   in a list, how it is shown, the commands of the parent. A part that reads the runtime itself, e.g. an editor or a
   result table, comes in as a slot, a function of the props it needs that the parent renders.
3. **Add the module** to `COMPONENTS` of `packages/dashql-app/test/component_boundary_test.mjs`
   (`//packages/dashql-app:component_boundary_test`). It fails when the module imports the hooks of the runtime, the
   runtime package, or a model for more than its types.
4. **Test the component** with a plain model, `fakeScriptModel` of `@akohn/dashql-react/testing/fake_models`: its
   operations are spies. Test a new operation of a model on a runtime, e.g. `models/script_model.test.tsx` of
   `@akohn/dashql-react` with `createTestRuntime` of `@akohn/dashql/runtime/testing/test_runtime`.
5. **Connect it** in the parent: the parent resolves the model with the hook and renders the slots, e.g.
   `ScriptFeedRow` of `workbook/feed/workbook_feed_row.tsx`.

## Example

```tsx
// The component: a model, the commands of the parent and a slot
export function ScriptCard({ model, feed, editor }: ScriptCardProps) {
    return (
        <article>
            <button onClick={() => void model.run()}>Run</button>
            {editor({ setView })}
            {model.script.pendingDiff != null && <button onClick={() => void model.acceptDiff()}>Accept</button>}
            <button onClick={() => feed.delete(model.script.fileName)}>Delete</button>
        </article>
    );
}

// The parent connects it
const model = useScriptModel(workbookId, scriptKey);
return model && <ScriptCard model={model} feed={feed} editor={slot => <ScriptEditor scriptKey={scriptKey} {...slot} />} />;

// The test of the component needs no runtime
const model = fakeScriptModel({ script: fakeScript(1, 'alpha.sql') });
render(<ScriptCard model={model} feed={feed} editor={() => null} />);
click('Run');
expect(model.run).toHaveBeenCalledOnce();
```

## What is not done yet

The feed card is the first component written this way. Parts of it still read the runtime below the card: the header
(`FeedEntryHeader`, shared with the dataflow and the editor dialog) and the chart builder. Its injectable
`ScriptCardDependencies` replace only the parts that need a real script session or editor in a test (formatting,
diagnostics, statistics, the chart builder), none of them reads the runtime. Models for connections, queries and
workbooks follow the same pattern.
