# @akohn/dashql-react

DashQL in React: the hooks of the runtime of [`@akohn/dashql`](../dashql/README.md), the models that components show,
the components, and the design tokens, fonts and icons of DashQL. The DashQL app is built from it, and so can be other
hosts of the runtime.

```sh
npm install @akohn/dashql @akohn/dashql-react react react-dom apache-arrow
```

`@akohn/dashql` is a peer of exactly the version of this package: the views of the runtime change with DashQL, so both
come from the same build. The Vega libraries are optional peers, for the charts.

## Using it

The modules keep the paths of the sources, every one is a subpath of its own:

```tsx
import '@akohn/dashql-react/style.css';
import '@akohn/dashql-react/styles/tokens.css';
import '@akohn/dashql-react/fonts/fonts.css';

import { Button } from '@akohn/dashql-react/components/button';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { RuntimeContextProvider, useScript } from '@akohn/dashql-react/hooks';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
```

- **`style.css`**: the stylesheets of all components, imported once. Their classes are `dashql_<class>_<hash>`.
- **`styles/tokens.css`, `styles/colors.css`, `styles/flavors/*.css`**: the design tokens that the components read as
  CSS variables, and the flavors that override them.
- **`fonts/fonts.css`**: Instrument Sans and JetBrains Mono with their font files (SIL Open Font License).
- **`symbols.svg`**: the icons and logos, one `<symbol>` each. `SymbolIcon` refers to them by the URL of the atlas
  next to the modules (`new URL('./symbols.svg', import.meta.url)`), which the bundler of the host emits as an asset.
  The atlas is served by the host: browsers resolve the `<use>` of a symbol only from the origin of the page.

## A page with a runtime

`platform/` holds what a page needs for a runtime: the core, the embedded Hyper and the runtime of the page. The
files of the core and of the engine are assets of the host, it passes their URLs. The embedded Hyper needs a
cross-origin isolated page (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`)
and a script of the page's origin that loads the worker of the engine:

```js
// hyperdb_worker_bridge.js, served by the host
const workerUrl = new URL(self.location.href).searchParams.get('workerUrl');
if (workerUrl == null) throw new Error('Missing HyperDB worker URL');
self.importScripts(workerUrl);
```

```tsx
import coreWasm from '@akohn/dashql/wasm?url';
import { BufferLogger } from '@akohn/dashql/platform/logger/logger';
import { setupWebHyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_web';
import { migrateStorage } from '@akohn/dashql/platform/storage/storage_migration';
import { openPageStorage } from '@akohn/dashql/platform/storage/page_storage';
import { createWorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { WebHttpClient } from '@akohn/dashql/platform/web_http_client';
import { createEmbeddedChannelConnector } from '@akohn/dashql/runtime/embedded_channels';
import { createRuntime } from '@akohn/dashql/runtime/runtime';
import { FRAME_UPDATE_SCHEDULER } from '@akohn/dashql/runtime/store/update_scheduler';
import { createRuntimeArchives } from '@akohn/dashql/runtime/workbook_archives';
import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';
import { LoggerContext } from '@akohn/dashql-react/logger';
import { DashQLCoreProvider, useDashQLCore, useDashQLCoreSetup } from '@akohn/dashql-react/platform/core_provider';
import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from '@akohn/dashql-react/platform/embedded_database_provider';
import { usePageRuntime } from '@akohn/dashql-react/platform/page_runtime';

const HYPERDB = {
    engine: hyperdbEngineUrl,        // hyperdb-wasm/dist/hyperdb-wasm.js
    wasm: hyperdbWasmUrl,            // hyperdb-wasm/dist/hyperdb-wasm.wasm
    worker: hyperdbWorkerUrl,        // hyperdb-wasm/dist/browser_worker.js
    workerBridge: '/hyperdb_worker_bridge.js',
};
const logger = new BufferLogger();

export const Page = () => (
    <LoggerContext.Provider value={logger}>
        <DashQLCoreProvider wasmUrl={coreWasm}>
            <EmbeddedDatabaseProvider setupDatabase={(context, logger, progress, options) => setupWebHyperDB(context, logger, HYPERDB, progress, options)}>
                <Console />
            </EmbeddedDatabaseProvider>
        </DashQLCoreProvider>
    </LoggerContext.Provider>
);

function Console() {
    const setupCore = useDashQLCoreSetup();
    const core = useDashQLCore();
    // Migrate the storage before anything reads it, a fresh one too, then open it
    const [storage, setStorage] = React.useState<Awaited<ReturnType<typeof openPageStorage>> | null>(null);
    React.useEffect(() => {
        void migrateStorage(logger, setupCore).then(async () => setStorage(await openPageStorage(await setupCore('storage'), logger)));
    }, [setupCore]);
    if (core == null || storage == null) return <Loading />;
    return <ConsoleRuntime core={core} storage={storage} />;
}

function ConsoleRuntime(props: { core: DashQL; storage: StorageBackend }) {
    // Null only outside of an EmbeddedDatabaseProvider
    const database = useEmbeddedDatabaseSetup()!;
    const runtime = usePageRuntime(() => createRuntime({
        logger,
        scheduler: FRAME_UPDATE_SCHEDULER,
        core: props.core,
        storage: props.storage,
        http: new WebHttpClient(),
        channels: createEmbeddedChannelConnector(database),
        computeDatabase: () => database('compute'),
        results: createWorkbookResultFiles(),
        archives: handles => createRuntimeArchives(handles, database),
        settings: { capabilities: [] },
    }));
    return <RuntimeContextProvider value={runtime}>{/* the hooks and models of the console */}</RuntimeContextProvider>;
}
```

Only one tab of an origin may write its storage: `AppOwnership` of `@akohn/dashql/platform/app_ownership` holds a Web
Lock for the tab and hands over to another one. `settings.capabilities` turns off the extensions of SQL that the
host doesn't offer ([capabilities.md](../../docs/design/capabilities.md)). The OAuth flow of a Salesforce connection is
not in the packages yet.

How the layers fit, the runtime, the models and the components, is described in
[dashql_runtime.md](../../docs/design/dashql_runtime.md) and
[writing_components.md](../../docs/agents/writing_components.md).

## The package

`//packages/dashql-react:npm_tarball` builds `dashql-react.tgz` with `npm/build.mjs`: Vite compiles the modules of
`src/` without the tests and their helpers (`src/testing`), every module keeps its path, the CSS modules become their
class names and one stylesheet, tsc writes the declarations next to the modules. The version is the npm version of the
build, the same as that of `@akohn/dashql`. `:tarball_consumer_test` installs the archive like a host and renders,
type checks and bundles a page with it.
