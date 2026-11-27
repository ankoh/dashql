import * as React from 'react';

import {
    EmbeddedDatabaseProvider as PageDatabaseProvider,
    useEmbeddedDatabaseTermination,
    type EmbeddedDatabaseFactory,
    type EmbeddedDatabaseOptions,
} from '@akohn/dashql-react/platform/embedded_database_provider';
import { useAppHandOver } from './app_hand_over.js';

export {
    useEmbeddedDatabaseSetup,
    type EmbeddedDatabaseOptions,
    type EmbeddedDatabaseSetupFn,
    type SetupProgress,
} from '@akohn/dashql-react/platform/embedded_database_provider';

/// The embedded Hyper of the app, loaded with its setup when it is first needed
const setupAppDatabase: EmbeddedDatabaseFactory = async (context, logger, onSetupProgress, options) => {
    const { setupWebHyperDB } = await import('./hyperdb/hyperdb_provider_web.js');
    return await setupWebHyperDB(context, logger, onSetupProgress, options);
};

interface Props {
    children: React.ReactNode;
    /// The database of a test, the embedded Hyper of the app by default
    setupDatabase?: EmbeddedDatabaseFactory;
    /// The startup options, null while they are not known yet, e.g. before the app settings are loaded.
    /// The instantiation waits for them.
    options?: EmbeddedDatabaseOptions | null;
}

/// The embedded database of the app. Another tab that takes over the app opens the files that the database shares with
/// it, e.g. the log extracts of the connections, the database closes them first.
export function EmbeddedDatabaseProvider(props: Props) {
    return (
        <PageDatabaseProvider setupDatabase={props.setupDatabase ?? setupAppDatabase} options={props.options}>
            <TerminateOnHandOver />
            {props.children}
        </PageDatabaseProvider>
    );
}

function TerminateOnHandOver() {
    useAppHandOver(useEmbeddedDatabaseTermination());
    return null;
}
