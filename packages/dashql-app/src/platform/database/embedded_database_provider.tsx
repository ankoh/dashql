import * as React from 'react';

import type { EmbeddedComputeDatabase } from './embedded_database.js';
import { useLogger } from '../logger/logger_provider.js';

const SETUP_CTX = React.createContext<EmbeddedDatabaseSetupFn | null>(null);

export interface SetupProgress {
    readonly bytesLoaded: number;
    readonly bytesTotal: number;
}

interface Props {
    children: React.ReactElement;
}

export const EmbeddedDatabaseProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const instantiation = React.useRef<Promise<EmbeddedComputeDatabase> | null>(null);

    const setup = React.useCallback(async (
        context: string,
        onSetupProgress?: (progress: SetupProgress) => void,
    ): Promise<EmbeddedComputeDatabase> => {
        if (instantiation.current != null) {
            return await instantiation.current;
        }

        const instantiate = async (): Promise<EmbeddedComputeDatabase> => {
            const { setupWebHyperDB } = await import('../hyperdb/hyperdb_provider_web.js');
            return await setupWebHyperDB(context, logger, onSetupProgress);
        };

        instantiation.current = instantiate().catch(error => {
            instantiation.current = null;
            throw error;
        });
        return await instantiation.current;
    }, [logger]);

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
