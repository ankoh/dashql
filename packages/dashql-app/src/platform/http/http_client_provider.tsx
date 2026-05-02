import * as React from 'react';

import { useLogger } from '../logger/logger_provider.js';
import { isNativePlatform } from '../native_globals.js';
import { NativeHttpClient } from './native_http_client.js';
import { WebHttpClient } from './web_http_client.js';
import { HttpClient } from './http_client.js';
import { HttpProxyConfigHolder } from './http_proxy.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<HttpClient | null>(null);
const PROXY_CONFIG_CTX = React.createContext<HttpProxyConfigHolder | null>(null);
export const useHttpClient = () => React.useContext(CLIENT_CTX)!;
export const useHttpProxyConfig = () => React.useContext(PROXY_CONFIG_CTX)!;

export const HttpClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const proxyConfigRef = React.useRef<HttpProxyConfigHolder>(null);
    if (proxyConfigRef.current == null) {
        proxyConfigRef.current = new HttpProxyConfigHolder();
    }
    const [client, setClient] = React.useState<HttpClient | null>(null);
    React.useEffect(() => {
        const proxyConfig = proxyConfigRef.current!;
        let client: HttpClient;
        if (isNativePlatform()) {
            client = new NativeHttpClient({ proxyEndpoint: new URL("dashql-native://localhost") }, proxyConfig, logger);
        } else {
            client = new WebHttpClient(proxyConfig, logger);
        }
        setClient(client);
    }, []);
    return (
        <PROXY_CONFIG_CTX.Provider value={proxyConfigRef.current}>
            <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>
        </PROXY_CONFIG_CTX.Provider>
    );
};
