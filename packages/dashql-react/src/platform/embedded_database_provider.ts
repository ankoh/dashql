import * as React from 'react';

import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import type { EmbeddedDatabaseOptions, SetupProgress } from '@akohn/dashql/platform/hyperdb/hyperdb_web';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../logger.js';

export type { EmbeddedDatabaseOptions, SetupProgress };

/// Starts the embedded database of a page, e.g. `setupWebHyperDB` of `@akohn/dashql/platform/hyperdb/hyperdb_web` with
/// the files of hyperdb-wasm that the page serves
export type EmbeddedDatabaseFactory = (
    context: string,
    logger: Logger,
    onSetupProgress?: (progress: SetupProgress) => void,
    options?: EmbeddedDatabaseOptions,
) => Promise<EmbeddedComputeDatabase>;

/// Set up the embedded database, the first call starts it and every call waits for it. The context names the caller in
/// the log.
export type EmbeddedDatabaseSetupFn = (
    context: string,
    onSetupProgress?: (progress: SetupProgress) => void,
) => Promise<EmbeddedComputeDatabase>;

interface EmbeddedDatabase {
    setup: EmbeddedDatabaseSetupFn;
    /// Terminate the database if it was started, the next setup starts it again
    terminate: () => Promise<void>;
}

const DATABASE_CTX = React.createContext<EmbeddedDatabase | null>(null);

const DEFAULT_OPTIONS: EmbeddedDatabaseOptions = {};

interface Props {
    setupDatabase: EmbeddedDatabaseFactory;
    /// The startup options, null while they are not known yet, e.g. before the settings of the host are loaded. The
    /// instantiation waits for them.
    options?: EmbeddedDatabaseOptions | null;
    children?: React.ReactNode;
}

/// The embedded database of a page, started when it is first needed (`useEmbeddedDatabaseSetup`) and terminated with
/// the provider. Needs a logger above it.
export function EmbeddedDatabaseProvider(props: Props) {
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

    const { setupDatabase } = props;
    const setup = React.useCallback<EmbeddedDatabaseSetupFn>(async (context, onSetupProgress) => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }
        const instantiate = async () => setupDatabase(context, logger, onSetupProgress, await options);
        instantiation.current = instantiate().catch(error => {
            instantiation.current = null;
            throw error;
        });
        return await instantiation.current;
    }, [logger, setupDatabase, options]);

    const terminate = React.useCallback(async () => {
        const pending = instantiation.current;
        instantiation.current = null;
        if (pending) {
            const database = await pending.catch(() => null);
            await database?.terminate();
        }
    }, []);

    React.useEffect(() => () => {
        void terminate().catch(() => { /* the database is gone with the page */ });
    }, [terminate]);

    const database = React.useMemo(() => ({ setup, terminate }), [setup, terminate]);
    return React.createElement(DATABASE_CTX.Provider, { value: database }, props.children);
}

/// Set up the embedded database of the provider above, null without one
export function useEmbeddedDatabaseSetup(): EmbeddedDatabaseSetupFn {
    return (React.useContext(DATABASE_CTX)?.setup ?? null) as EmbeddedDatabaseSetupFn;
}

/// Terminate the embedded database of the provider above, e.g. before another tab takes over the files of the page.
/// Does nothing without a provider.
export function useEmbeddedDatabaseTermination(): () => Promise<void> {
    return React.useContext(DATABASE_CTX)?.terminate ?? NO_TERMINATION;
}

const NO_TERMINATION = async () => { };
