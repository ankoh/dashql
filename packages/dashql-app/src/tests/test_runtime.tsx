import * as React from 'react';
import * as core from '@akohn/dashql';

import type { QueryCommands } from '@akohn/dashql/runtime/runtime';

import { RuntimeProvider } from '../runtime/runtime_provider.js';

/// The query commands of the runtime that a test replaces
export type TestQueryExecutorFunctions = Partial<QueryCommands>;

interface TestRuntimeProps extends TestQueryExecutorFunctions {
    /// Keep the catalog loader running. It asks connections that come online about their catalogs, the tests of
    /// components stop it like the tests of the runtime (packages/dashql/src/runtime/testing/test_runtime.ts).
    catalogLoader?: boolean;
    /// The core of the runtime, by default the one that the package instantiated, e.g. in a `beforeAll` of the test
    core?: core.DashQL;
    children?: React.ReactNode;
}

/// The runtime of the app in a test: the RuntimeProvider over the providers above it with the core of the test, the
/// catalog loader stopped and the query commands that the test replaces (`queryCommands` of the runtime). The
/// components call the replaced commands, the services of the runtime keep the query executor of the module.
export function TestRuntime(props: TestRuntimeProps) {
    const { children, catalogLoader, core: instance, execute, cancel, watchProfile } = props;
    // The connections are slices of the runtime, it is created with the core before they are created
    const [testCore] = React.useState(() => instance ?? core.DashQL.instantiated() ?? undefined);
    const queryCommands = { execute, cancel, watchProfile };
    return (
        <RuntimeProvider core={testCore} catalogLoader={catalogLoader === true} queryCommands={queryCommands}>
            {children}
        </RuntimeProvider>
    );
}
