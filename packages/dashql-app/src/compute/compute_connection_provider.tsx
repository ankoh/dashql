import * as React from 'react';

import { DuckDB } from '../platform/duckdb/duckdb_api.js';
import { useDuckDBSetup } from '../platform/duckdb/duckdb_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';

const COMPUTE_DB_CTX = React.createContext<DuckDB | null>(null);

interface Props {
    children?: React.ReactElement;
}

export const ComputeConnectionProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const setupWebDB = useDuckDBSetup();
    const [duckdb, setDuckdb] = React.useState<DuckDB | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        const init = async () => {
            try {
                const webdb = await setupWebDB("compute");
                if (!cancelled) {
                    setDuckdb(webdb);
                }
            } catch (e: any) {
                logger.error("failed to create compute database", { error: e.toString() }, "compute");
            }
        };
        init();
        return () => { cancelled = true; };
    }, [setupWebDB, logger]);

    return (
        <COMPUTE_DB_CTX.Provider value={duckdb}>
            {props.children}
        </COMPUTE_DB_CTX.Provider>
    );
};

export function useComputeDatabase(): DuckDB | null {
    return React.useContext(COMPUTE_DB_CTX);
}
