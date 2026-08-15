import * as React from 'react';

import type { EmbeddedComputeDatabase } from '../../../shared/platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../../../shared/platform/database/embedded_database_provider.js';
import { useLogger } from '../../../shared/platform/logger/logger_provider.js';
import { stringifyError } from '../../../shared/platform/logger/logger.js';

const COMPUTE_DB_CTX = React.createContext<EmbeddedComputeDatabase | null>(null);

interface Props {
    children?: React.ReactElement;
}

export const ComputeConnectionProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const [database, setDatabase] = React.useState<EmbeddedComputeDatabase | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        const init = async () => {
            try {
                const embeddedDatabase = await setupEmbeddedDatabase("compute");
                if (!cancelled) {
                    setDatabase(embeddedDatabase);
                }
            } catch (e: any) {
                logger.warn("Failed to create compute database", { error: stringifyError(e) }, "compute");
            }
        };
        init();
        return () => { cancelled = true; };
    }, [setupEmbeddedDatabase, logger]);

    return (
        <COMPUTE_DB_CTX.Provider value={database}>
            {props.children}
        </COMPUTE_DB_CTX.Provider>
    );
};

export function useComputeDatabase(): EmbeddedComputeDatabase | null {
    return React.useContext(COMPUTE_DB_CTX);
}
