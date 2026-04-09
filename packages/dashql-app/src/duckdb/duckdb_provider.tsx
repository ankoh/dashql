import * as React from 'react';

import { DuckDB } from './duckdb_api.js';
import { useLogger } from '../platform/logger_provider.js';
import { isNativePlatform } from '../platform/native_globals.js';

const SETUP_CTX = React.createContext<((context: string) => Promise<DuckDB>) | null>(null);

interface Props {
    children: React.ReactElement;
}

export const DuckDBProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<DuckDB> | null>(null);

    const setup = React.useCallback(async (context: string): Promise<DuckDB> => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const instantiate = async (): Promise<DuckDB> => {
            if (process.env.DASHQL_NATIVE_BUILD === 'true' || isNativePlatform()) {
                const { setupNativeDuckDB } = await import('./duckdb_provider_native.js');
                return await setupNativeDuckDB(context, logger);
            }
            const { setupWebDuckDB } = await import('./duckdb_provider_web.js');
            return await setupWebDuckDB(context, logger);
        };

        instantiation.current = instantiate();
        return await instantiation.current;
    }, [logger]);

    return (
        <SETUP_CTX.Provider value={setup}>
            {props.children}
        </SETUP_CTX.Provider>
    );
};

export type DuckDBSetupFn = (context: string) => Promise<DuckDB>;
export function useDuckDBSetup(): DuckDBSetupFn {
    return React.useContext(SETUP_CTX)!;
}
