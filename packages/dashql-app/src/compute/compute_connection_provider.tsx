import * as React from 'react';

import { DuckDBConnection } from '../duckdb/duckdb_api.js';
import { useDuckDBSetup } from '../duckdb/duckdb_provider.js';
import { useLogger } from '../platform/logger_provider.js';

const COMPUTE_CONN_CTX = React.createContext<DuckDBConnection | null>(null);

interface Props {
    children?: React.ReactElement;
}

export const ComputeConnectionProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const setupWebDB = useDuckDBSetup();
    const [conn, setConn] = React.useState<DuckDBConnection | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        const init = async () => {
            try {
                const webdb = await setupWebDB("compute");
                const connection = await webdb.connect();
                if (!cancelled) {
                    setConn(connection);
                } else {
                    await connection.close();
                }
            } catch (e: any) {
                logger.error("failed to create compute connection", { error: e.toString() }, "compute");
            }
        };
        init();
        return () => { cancelled = true; };
    }, [setupWebDB, logger]);

    return (
        <COMPUTE_CONN_CTX.Provider value={conn}>
            {props.children}
        </COMPUTE_CONN_CTX.Provider>
    );
};

export function useComputeConnection(): DuckDBConnection | null {
    return React.useContext(COMPUTE_CONN_CTX);
}
