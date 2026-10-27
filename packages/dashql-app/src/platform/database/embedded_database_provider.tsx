import * as React from 'react';

import type { EmbeddedComputeDatabase } from './embedded_database.js';
import type { Logger } from '../logger/logger.js';
import { useLogger } from '../logger/logger_provider.js';
import { useAppHandOver } from '../crosstab/app_hand_over.js';

const SETUP_CTX = React.createContext<EmbeddedDatabaseSetupFn | null>(null);

export interface SetupProgress {
    readonly bytesLoaded: number;
    readonly bytesTotal: number;
}

/// The startup options of the embedded database, they apply when it is instantiated
export interface EmbeddedDatabaseOptions {
    /// Run the queries on the experimental wasm backend of HyperDB, the default backend if the engine has none
    experimentalWasmBackend?: boolean;
}

const DEFAULT_OPTIONS: EmbeddedDatabaseOptions = {};

interface Props {
    children: React.ReactElement;
    setupDatabase?: EmbeddedDatabaseFactory;
    /// The startup options, null while they are not known yet, e.g. before the app settings are loaded.
    /// The instantiation waits for them.
    options?: EmbeddedDatabaseOptions | null;
}

type EmbeddedDatabaseFactory = (
    context: string,
    logger: Logger,
    onSetupProgress?: (progress: SetupProgress) => void,
    options?: EmbeddedDatabaseOptions,
) => Promise<EmbeddedComputeDatabase>;

const setupDefaultDatabase: EmbeddedDatabaseFactory = async (context, logger, onSetupProgress, options) => {
    const { setupWebHyperDB } = await import('../hyperdb/hyperdb_provider_web.js');
    return await setupWebHyperDB(context, logger, onSetupProgress, options);
};

export const EmbeddedDatabaseProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<EmbeddedComputeDatabase> | null>(null);

    // The options of the first instantiation, the instantiation waits until they are known
    const [options, resolveOptions] = React.useMemo(() => {
        let resolve: (options: EmbeddedDatabaseOptions) => void;
        const promise = new Promise<EmbeddedDatabaseOptions>(r => { resolve = r; });
        return [promise, resolve!] as const;
    }, []);
    const knownOptions = props.options === undefined ? DEFAULT_OPTIONS : props.options;
    React.useEffect(() => {
        if (knownOptions != null) resolveOptions(knownOptions);
    }, [knownOptions, resolveOptions]);

    const setup = React.useCallback(async (
        context: string,
        onSetupProgress?: (progress: SetupProgress) => void,
    ): Promise<EmbeddedComputeDatabase> => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const instantiate = async (): Promise<EmbeddedComputeDatabase> =>
            (props.setupDatabase ?? setupDefaultDatabase)(context, logger, onSetupProgress, await options);

        instantiation.current = instantiate().catch(error => {
            instantiation.current = null;
            throw error;
        });
        return await instantiation.current;
    }, [logger, props.setupDatabase, options]);

    // Another tab takes over the app. The database closes the files it shares with the other tab, e.g.
    // the log extracts of the connections, before that tab opens them.
    useAppHandOver(async () => {
        const pending = instantiation.current;
        instantiation.current = null;
        if (pending) {
            const database = await pending.catch(() => null);
            await database?.terminate();
        }
    });

    React.useEffect(() => {
        return () => {
            const pending = instantiation.current;
            instantiation.current = null;
            if (pending) {
                pending
                    .then(database => database.terminate())
                    .catch(() => { /* instantiation failed - nothing to terminate */ });
            }
        };
    }, []);

    return (
        <SETUP_CTX.Provider value={setup}>
            {props.children}
        </SETUP_CTX.Provider>
    );
};

export type EmbeddedDatabaseSetupFn = (
    context: string,
    onSetupProgress?: (progress: SetupProgress) => void,
) => Promise<EmbeddedComputeDatabase>;
export function useEmbeddedDatabaseSetup(): EmbeddedDatabaseSetupFn {
    return React.useContext(SETUP_CTX)!;
}
