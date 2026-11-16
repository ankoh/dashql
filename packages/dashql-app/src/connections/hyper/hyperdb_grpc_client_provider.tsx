import * as React from 'react';

import { isDesktopHost } from '../../platform/native_globals.js';
import { HyperDatabaseClient } from '@akohn/dashql/platform/connections/hyper/hyperdb_grpc_client';
import { NativeHyperDatabaseClient } from './native_hyperdb_grpc_client.js';
import { useLogger } from '../../platform/logger_provider.js';

type Props = {
    children: React.ReactElement;
};

// The client of Hyper over gRPC through the native proxy of the desktop app. The runtime speaks Hyper over HTTP itself.
const GRPC_CLIENT_CTX = React.createContext<HyperDatabaseClient | null>(null);

export const useHyperGrpcClient = () => React.useContext(GRPC_CLIENT_CTX);

export const HyperDatabaseClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const [grpcClient, setGrpcClient] = React.useState<HyperDatabaseClient | null>(null);
    React.useEffect(() => {
        if (isDesktopHost()) {
            setGrpcClient(new NativeHyperDatabaseClient({ proxyEndpoint: new URL("dashql-native://localhost") }, logger));
        }
    }, []);
    return (
        <GRPC_CLIENT_CTX.Provider value={grpcClient}>
            {props.children}
        </GRPC_CLIENT_CTX.Provider>
    );
};
