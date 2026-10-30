import * as React from 'react';

import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../../platform/database/embedded_database_provider.js';
import type { HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = 'demos';

/// The data source of a demo, the HyperDB WASM of the page
export interface DemoDataSource {
    /// The Hyper that the queries of the demo read
    database: HyperDBSourceDatabase;
    /// The HyperDB WASM of the page, the demo fills it itself
    embedded: EmbeddedComputeDatabase;
    /// The version of the Hyper
    version: string | null;
}

/// The state of the setup of a data source
export interface DemoDataSourceState {
    /// The connected source, null while it is set up or after it failed
    source: DemoDataSource | null;
    /// The error of the setup
    error: string | null;
}

/// Set up the data source of a demo
export function useDemoDataSource(): DemoDataSourceState {
    const logger = useLogger();
    const setupEmbedded = useEmbeddedDatabaseSetup();
    const [state, setState] = React.useState<DemoDataSourceState>({ source: null, error: null });

    React.useEffect(() => {
        setState({ source: null, error: null });
        let cancelled = false;
        const setup = async (): Promise<DemoDataSource> => {
            const embedded = await setupEmbedded('demos');
            // The tables of the demo live in the user database of the page, a fresh one per page load
            const database: HyperDBSourceDatabase = {
                connect: options => embedded.connect({ ...options, defaultDatabase: 'hyper' }),
            };
            return { database, embedded, version: await embedded.getVersion() };
        };
        setup().then(
            source => { if (!cancelled) setState({ source, error: null }); },
            error => {
                logger.error('Setting up the data source of the demo failed', { error: stringifyError(error) }, LOG_CTX);
                if (!cancelled) setState({ source: null, error: error instanceof Error ? error.message : String(error) });
            },
        );
        return () => { cancelled = true; };
    }, [setupEmbedded, logger]);

    return state;
}
