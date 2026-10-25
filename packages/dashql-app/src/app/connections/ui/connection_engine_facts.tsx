import * as React from 'react';

import { useEmbeddedDatabaseSetup } from '../../../platform/database/embedded_database_provider.js';
import type { ConnectionState } from '../connection_state.js';

/// The version of the embedded Hyper, null until it is read or for a remote Hyper
function useEmbeddedHyperVersion(embedded: boolean): string | null {
    const setupDatabase = useEmbeddedDatabaseSetup();
    const [version, setVersion] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (!embedded) {
            setVersion(null);
            return;
        }
        let cancelled = false;
        setupDatabase('connection_overview')
            .then(database => database.getVersion())
            .then(v => { if (!cancelled) setVersion(v); })
            .catch(() => { if (!cancelled) setVersion(null); });
        return () => { cancelled = true; };
    }, [setupDatabase, embedded]);
    return version;
}

/// The names of the protocols of the Hyper connections
const HYPER_PROTOCOL_NAMES: Record<string, string> = {
    WASM: 'embedded (WebAssembly)',
    V3_GRPC: 'gRPC',
    V3_HTTP: 'HTTP',
};

interface Props {
    /// The connection
    connection: ConnectionState;
}

/// The facts about the Hyper of a connection: its version or endpoint and the protocol
export const ConnectionEngineFacts: React.FC<Props> = ({ connection }) => {
    const params = 'hyper' in connection.params ? connection.params.hyper : null;
    const embedded = params?.protocol === 'WASM';
    const version = useEmbeddedHyperVersion(embedded);
    const protocol = HYPER_PROTOCOL_NAMES[params?.protocol ?? 'WASM'] ?? params?.protocol;
    return (
        <span data-testid="connection-engine">
            <span data-testid="detail-version">{version == null ? 'Hyper' : `Hyper ${version}`}</span>
            {' · '}
            <span data-testid="detail-engine">{protocol}</span>
            {!embedded && params?.endpoint && (
                <>
                    {' · '}
                    <span title={params.endpoint} data-testid="detail-endpoint">{params.endpoint}</span>
                </>
            )}
        </span>
    );
};
