# Writing a component

A component of the app shows a model and the state of the user interface. It doesn't talk to the runtime: it knows no
view kinds, slices, targets, actions, commands or handles, and it doesn't need to know when the store flushes. Those
stay in the model hooks, one per thing that the app shows. The runtime itself is described in
[dashql_runtime.md](../design/dashql_runtime.md), read it when you change the runtime or a model.

## The layers

| Layer | Where | Knows |
|---|---|---|
| Components | the app, e.g. `workbook/feed/script_card.tsx` | A model, plain props, slots. No import of the runtime |
| Models | `packages/dashql-app/src/runtime/models/` | The views, the actions of a target, the commands of the facade, `settled` |
| Runtime | `@akohn/dashql/runtime`, the core module | Everything else |

A model is an interface with a hook that implements it over the runtime, e.g. `ScriptModel` and `useScriptModel` of
`runtime/models/script_model.tsx`: the script, its latest query and whether its workbook runs, and the operations
`run`, `cancel`, `setText`, `acceptDiff`, `rejectDiff`, `setVisSpec`. An operation that changes state resolves once the
store shows the change (`settled` of the dispatch), and the component renders with a new model right after. A model is
the state of one render: the object a handler holds doesn't change after an `await`, the next render brings the new one.

A model binds and decides nothing. A decision that a model or a component would have to make about the runtime, e.g.
whether a cancel stops the run of the workbook or the query of a script, is a command or an action of the core instead
(`cancelScript`), see [core_first.md](core_first.md).

## Recipe

1. **Find the model** of what the component shows. If an operation is missing, add it to the interface and the hook. If
   the runtime has no action or command for it, add that first: an action of the union of its target in
   `packages/dashql-core-wasm/src/runtime/actions.rs`, or a command of the facade.
2. **Write the component** against the interface of the model and plain props. Group props by what they are: the place
   in a list, how it is shown, the commands of the parent. A part that reads the runtime itself, e.g. an editor or a
   result table, comes in as a slot, a function of the props it needs that the parent renders.
3. **Add the module** to `COMPONENTS` of `packages/dashql-app/test/component_boundary_test.mjs`
   (`//packages/dashql-app:component_boundary_test`). It fails when the module imports the hooks of the runtime, the
   runtime package, or a model for more than its types.
4. **Test the component** with a plain model, `fakeScriptModel` of `src/tests/fake_models.ts`: its operations are spies.
   Test a new operation of a model on a runtime, e.g. `runtime/models/script_model.test.tsx` with `TestRuntime`.
5. **Connect it** in the parent: the parent resolves the model with the hook and renders the slots, e.g.
   `ScriptFeedRow` of `workbook/feed/workbook_feed_row.tsx`. A test of the parent hands it other models with
   `ScriptModelProvider` and `fakeScriptModels`.

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
