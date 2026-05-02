import * as React from 'react';

import { isNativePlatform } from '../../platform/native_globals.js';
import { HyperDatabaseClient } from '../../connection/hyper/hyperdb_grpc_client.js';
import { NativeHyperDatabaseClient } from '../../platform/hyperdb/native_hyperdb_grpc_client.js';
import { WebHyperDatabaseClient } from '../../platform/hyperdb/web_hyperdb_http_client.js';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<HyperDatabaseClient | null>(null);
export const useHyperDatabaseClient = () => React.useContext(CLIENT_CTX);

export const HyperDatabaseClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const httpClient = useHttpClient();
    const [client, setClient] = React.useState<HyperDatabaseClient | null>(null);
    React.useEffect(() => {
        if (isNativePlatform()) {
            setClient(new NativeHyperDatabaseClient({ proxyEndpoint: new URL("dashql-native://localhost") }, logger));
        } else if (httpClient) {
            setClient(new WebHyperDatabaseClient(httpClient, logger));
        }
    }, [httpClient]);
    return <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>;
};
