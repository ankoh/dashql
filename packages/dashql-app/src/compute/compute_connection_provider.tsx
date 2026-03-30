import * as React from 'react';

import { WebDBConnection } from '../webdb/api.js';
import { useWebDBSetup } from '../webdb/webdb_provider.js';
import { useLogger } from '../platform/logger_provider.js';

const COMPUTE_CONN_CTX = React.createContext<WebDBConnection | null>(null);

interface Props {
    children?: React.ReactElement;
}

export const ComputeConnectionProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const setupWebDB = useWebDBSetup();
    const [conn, setConn] = React.useState<WebDBConnection | null>(null);

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

export const useComputeConnection = () => React.useContext(COMPUTE_CONN_CTX);
