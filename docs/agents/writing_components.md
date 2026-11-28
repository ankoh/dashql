# Writing a component

A component of the app shows a model and the state of the user interface. It gets three things:

- **A model and plain props.** The model is what it shows of the runtime with its operations (the table below), the
  props are the place in a list, how it is shown and the commands of the parent.
- **The services of the host through `useHost()`** of `@akohn/dashql-react/host`: `setupCore` (the core module, e.g. to
  lay out a plan or rotate a profile) and `downloadFile` (save a file of the user, a download of the browser by
  default). The app fills them once: `DashQLCoreProvider` provides its core as the core of the host. A test hands a spy
  with `HostProvider`. The logger (`useLogger` of `logger`), the brand (`useBrand` of `brand/brand`) and the color
  scheme (`useColorScheme` of `theme/color_scheme`) come from the host the same way, as contexts of their own: the host
  sets them up before its core.
- **Slots for the parts that read the runtime or are the app's own**, e.g. an editor of CodeMirror, the table of a
  result with its cell overlay, the action menu that rewrites a script. A slot is a function of the props it needs
  that the parent renders.

The hooks of the runtime, the models and the components that other hosts share are the package `@akohn/dashql-react`
(`packages/dashql-react`): the building blocks (buttons, overlays, inputs, tabs, the JSON view, ...) in
`src/components` with their stylesheets, their helpers in `src/dom`, imported as `@akohn/dashql-react/components/button`
and `@akohn/dashql-react/dom/anchored_position`. The largest is the data table (`components/data_table/data_table`, its
entry module exports what a host uses): it shows a computation model, takes the column header as a prop and the detail
of a cell as a slot; the app wraps it in `DataTableView` (`results/data_table_view.tsx`) of the same model, with the
column plots of the settings and its cell overlay. The result of a query (`components/query_result`: header, panel,
details, the card of the full table, the search, the download, the action menu and the detail of a cell), the progress
panel, the query profile, the profile of a plan text (`query_profile/engine_profile_view`) and history views, the
Vega-Lite chart and view (`components/vegalite_view`, with the library in `vegalite/`) and the visualizations
(`components/visualization`: the Markdown view, the chart preview and download, the dispatch on the renderer and the
panel with its header) are there too. They take a `QueryModel`; the app uses them directly and keeps a container only
where it fills a slot: the header, the panel and the details of a result (the download with the Parquet export of its
compute database, the action menu, the table), the dispatch and the panel of a visualization (the table renderer), the
card of the full table, the detail of a cell (the views of CodeMirror) and the progress panel (it asks the connector
for the profile while it shows).

A view that appears with many heavy parts at once, e.g. the charts and tables of the cards of the dashboard, renders
each of them in `Deferred` (`components/deferred`) with a `Skeleton` (`components/skeleton`, the faint logo of the flavor)
as its fallback: the parts render one per idle period of the browser (`CalmFrameSchedule` of `dom/calm_frames`), and a
switch of the view holds them until its transitions end (`hold` of `useRenderSchedule()` with `transitionsEnd`, see
`workbook_feed_page.tsx`), not for a fixed time. A test that looks at the parts right away provides `IMMEDIATE_SCHEDULE`
with `RenderScheduleContext`.

A rule about SQL that a component would need goes into the core and reaches the component through its container, e.g.
the projection of the columns of a result (`rewriteResultProjection` of a script session). A component shared there
reaches neither the hooks nor the runtime of `@akohn/dashql`, a model only by type
(`//packages/dashql-react:boundary_test`). Their tests sit next to them (`data_table/data_table_focus.test.tsx`) with the helpers of
`src/testing` (`react_act`, `ResizeObserverMock`, `fake_models`, `computation_mocks`); the browser tests of the app run
them as `dashql-react/src/<path>` (`//packages/dashql-react:browser_test_files`, `//packages/dashql-app:test_chromium`).
A component doesn't talk to the runtime: it knows no view kinds, slices, targets, actions, commands or handles, and it
doesn't need to know when the store flushes. Those stay in the model hooks, one per thing that the app shows. The
runtime itself is described in [dashql_runtime.md](../design/dashql_runtime.md), read it when you change the runtime or
a model.

## The layers

| Layer | Where | Knows |
|---|---|---|
| Components | `@akohn/dashql-react/components/...`, or the app, e.g. `workbook/feed/script_card.tsx` | A model, plain props, `useHost()`, slots. No import of the runtime |
| Models | `@akohn/dashql-react/models/...` (`packages/dashql-react/src/models/`) | The views, the actions of a target, the commands of the facade, `settled` |
| Runtime | `@akohn/dashql/runtime`, the core module | Everything else |

A model is an interface with a hook that implements it over the runtime:

| Model | Shows | Operations |
|---|---|---|
| `useScriptModel` (`models/script_model`) | the script, the model of its latest query, whether its workbook runs | `run`, `cancel`, `setText`, `acceptDiff`, `rejectDiff`, `setVisSpec` |
| `useQueryModel` (`models/query_model`) | the query, its progress, its result as an Arrow table, the model of the computation of the result | `cancel` |
| `useComputationModel` (`models/computation_model`) | the computation of a result table and the Arrow tables of its handles | `dispatch` of a computation action (filters, ordering, searches, summaries), `readRows` of a window of the rows that show, `previewRows` of rows of the result in its order, e.g. the last rows of a KPI card |

Each has a fake in `@akohn/dashql-react/testing/fake_models`, `mockTableComputation` of `testing/computation_mocks`
gives a fake computation its view. What a component derives from a model is a function of the component, e.g. the rows
of a result (`resultRowCount` and `useResultRowCounts` of `components/query_result/query_result_toolbar`) or the rows
that a card reads (`useResultRows` of `components/visualization/result_rows`). An operation that changes state resolves
once the store shows the change (`settled` of the dispatch), and the component renders with a new model right after. A
model is the state of one render: the object a handler holds doesn't change after an `await`, the next render brings the
new one. The operations of a script model keep their identity while the script keeps its key, so a memoized part of a
component that takes them and the parts of the model it shows doesn't render with every keystroke, e.g. the result of
the feed card (`ScriptCardResult` of `workbook/feed/script_card.tsx`).

A model binds and decides nothing. A decision that a model or a component would have to make about the runtime, e.g.
whether a cancel stops the run of the workbook or the query of a script, is a command or an action of the core instead
(`cancelScript`), see [core_first.md](core_first.md).

## Recipe

1. **Find the model** of what the component shows. If an operation is missing, add it to the interface and the hook. If
   the runtime has no action or command for it, add that first: an action of the union of its target in
   `packages/dashql-core-bindings/src/runtime/actions.rs`, or a command of the facade.
2. **Write the component** against the interface of the model and plain props. Group props by what they are: the place
   in a list, how it is shown, the commands of the parent. The core and the downloads come from `useHost()`, not as
   props. A part that reads the runtime itself or is the app's own, e.g. an editor or a result table, comes in as a
   slot, a function of the props it needs that the parent renders.
3. **Add the module** to `COMPONENTS` of `packages/dashql-app/test/component_boundary_test.mjs`
   (`//packages/dashql-app:component_boundary_test`). It fails when the module imports the hooks of the runtime, the
   runtime package, or a model for more than its types.
4. **Test the component** with a plain model, e.g. `fakeScriptModel` or `fakeQueryModel` of
   `@akohn/dashql-react/testing/fake_models`: its operations are spies. A test of a component that downloads a file
   wraps it in `HostProvider` with a spy as `downloadFile`. Don't add a `dependencies` prop to swap the children of a
   thin container: hand the component a fake model instead, and keep `dependencies` for heavy leaf parts that a test
   can't run, e.g. the embedding of Vega or the layout of a plan. Test a new operation of a model on a runtime, e.g. `models/script_model.test.tsx` of
   `@akohn/dashql-react` with `createTestRuntime` of `@akohn/dashql/runtime/testing/test_runtime`.
5. **Connect it** in the parent: the parent resolves the model with the hook and renders the slots, e.g.
   `ScriptFeedRow` of `workbook/feed/workbook_feed_row.tsx`. A container that would only resolve a model and pass it
   on is no container: the parent uses the component directly.

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

The feed card with its header (`FeedEntryHeader`), the cards and the overlays of the dashboard and the views of a result
are written this way. The boxes of the dataflow and the editor dialog show the same header, `ScriptEntryHeader`
resolves its model and adds rename, delete and the connection of the script. Parts of the header still read the
runtime below it: the connection picker. The injectable `ScriptCardDependencies` replace only the parts that need a real
script session or editor in a test (formatting, diagnostics, statistics, the chart builder), none of them reads the
runtime. Models for connections and workbooks
follow the same pattern.
