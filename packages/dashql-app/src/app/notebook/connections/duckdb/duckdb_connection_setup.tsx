import * as React from 'react';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { Dispatch } from '../../../../utils/index.js';
import { stringifyError, type Logger } from '../../../../platform/logger/logger.js';
import { useLogger } from '../../../../platform/logger/logger_provider.js';
import { useEmbeddedDatabaseSetup } from '../../../../platform/database/embedded_database_provider.js';
import { isNativePlatform } from '../../../../platform/native_globals.js';
import { RESET_CONNECTION } from '../connection_state.js';
import { EmbeddedDatabaseChannel } from '../embedded/embedded_database_channel.js';
import {
    DUCKDB_CHANNEL_READY,
    DUCKDB_CHANNEL_SETUP_CANCELLED,
    DUCKDB_CHANNEL_SETUP_FAILED,
    DUCKDB_CHANNEL_SETUP_STARTED,
    type DuckDBConnectorAction,
} from './duckdb_connection_state.js';

const LOG_CTX = 'duckdb_setup';

export async function setupDuckDBConnection(
    updateState: Dispatch<DuckDBConnectorAction>,
    logger: Logger,
    params: connection.DuckDBConnectionParams,
    setupEmbeddedDatabase: ReturnType<typeof useEmbeddedDatabaseSetup>,
    abortSignal: AbortSignal,
): Promise<EmbeddedDatabaseChannel> {
    let channel: EmbeddedDatabaseChannel | null = null;
    try {
        if (!isNativePlatform()) throw new Error('DuckDB is only available in the native app');
        updateState({ type: DUCKDB_CHANNEL_SETUP_STARTED, value: params });
        abortSignal.throwIfAborted();
        const database = await setupEmbeddedDatabase('duckdb_connector');
        channel = new EmbeddedDatabaseChannel(await database.connect());
        abortSignal.throwIfAborted();
        updateState({ type: DUCKDB_CHANNEL_READY, value: channel });
        return channel;
    } catch (error: any) {
        await channel?.close();
        const detail = { message: stringifyError(error) };
        if (error?.name === 'AbortError') {
            updateState({ type: DUCKDB_CHANNEL_SETUP_CANCELLED, value: detail });
        } else {
            logger.warn('Setup failed', { error: detail.message }, LOG_CTX);
            updateState({ type: DUCKDB_CHANNEL_SETUP_FAILED, value: detail });
        }
        throw error;
    }
}

export interface DuckDBSetupApi {
    setup(dispatch: Dispatch<DuckDBConnectorAction>, params: connection.DuckDBConnectionParams, abort: AbortSignal): Promise<EmbeddedDatabaseChannel>;
    reset(dispatch: Dispatch<DuckDBConnectorAction>): Promise<void>;
}

const SETUP_CTX = React.createContext<DuckDBSetupApi | null>(null);
export const useDuckDBSetup = () => React.useContext(SETUP_CTX);

export const DuckDBSetupProvider: React.FC<React.PropsWithChildren> = props => {
    const logger = useLogger();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const api = React.useMemo<DuckDBSetupApi>(() => ({
        setup: (dispatch, params, abort) => setupDuckDBConnection(dispatch, logger, params, setupEmbeddedDatabase, abort),
        reset: async dispatch => dispatch({ type: RESET_CONNECTION, value: null }),
    }), [logger, setupEmbeddedDatabase]);
    return <SETUP_CTX.Provider value={api}>{props.children}</SETUP_CTX.Provider>;
};
