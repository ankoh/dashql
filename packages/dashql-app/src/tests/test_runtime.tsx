import * as React from 'react';
import * as core from '@ankoh/dashql';

import type { CancelQuery, QueryExecutor, WatchQueryProfile } from '@ankoh/dashql/platform/connections/query_execution_args';

import { RuntimeProvider } from '../runtime/runtime_provider.js';
import { useRuntime } from '../runtime/runtime_hooks.js';

/// The functions of the query executor that a test replaces
export interface TestQueryExecutorFunctions {
    execute?: QueryExecutor;
    cancel?: CancelQuery;
    watchProfile?: WatchQueryProfile;
}

interface TestRuntimeProps extends TestQueryExecutorFunctions {
    /// Keep the catalog loader running. It asks connections that come online about their catalogs, the tests of
    /// components stop it like the tests of the runtime (packages/dashql/src/runtime/testing/test_runtime.ts).
    catalogLoader?: boolean;
    /// The core of the runtime, by default the one that the package instantiated, e.g. in a `beforeAll` of the test
    core?: core.DashQL;
    children?: React.ReactNode;
}

/// The runtime of the app in a test: the RuntimeProvider over the providers above it, the catalog loader stopped and
/// the functions of the query executor that the test replaces
export function TestRuntime(props: TestRuntimeProps) {
    const { children, ...setup } = props;
    return (
        <RuntimeProvider>
            <TestRuntimeSetup {...setup}>{children}</TestRuntimeSetup>
        </RuntimeProvider>
    );
}

function TestRuntimeSetup(props: TestRuntimeProps) {
    const runtime = useRuntime();
    // Before the components below render and create their connections and workbooks
    React.useState(() => {
        if (!props.catalogLoader) runtime.runCatalogLoader(false);
        // The connections are slices of the runtime, it needs its core before they are created
        const instance = props.core ?? core.DashQL.instantiated();
        if (instance != null) runtime.setCore(instance);
    });
    return <TestQueryExecutor execute={props.execute} cancel={props.cancel} watchProfile={props.watchProfile}>{props.children}</TestQueryExecutor>;
}

/// Replace functions of the query executor of the runtime for the components below, before they render. The
/// components call the executor of the runtime, the services of the runtime keep the real one.
export function TestQueryExecutor(props: TestQueryExecutorFunctions & { children?: React.ReactNode }) {
    const executor = useRuntime();
    if (props.execute) executor.execute = props.execute;
    if (props.cancel) executor.cancel = props.cancel;
    if (props.watchProfile) executor.watchProfile = props.watchProfile;
    return <>{props.children}</>;
}
