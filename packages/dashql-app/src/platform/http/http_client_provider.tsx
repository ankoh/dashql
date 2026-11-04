import * as React from 'react';

import { useLogger } from '../logger/logger_provider.js';
import { isDesktopHost } from '../native_globals.js';
import { NativeHttpClient } from './native_http_client.js';
import { WebHttpClient } from './web_http_client.js';
import { HttpClient } from './http_client.js';
import { HttpRequestLog, RecordingHttpClient } from './http_request_log.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<HttpClient | null>(null);
const REQUEST_LOG_CTX = React.createContext<HttpRequestLog | null>(null);
export const useHttpClient = () => React.useContext(CLIENT_CTX)!;
/// The log of the requests of the http client, null outside of the provider
export const useHttpRequestLog = () => React.useContext(REQUEST_LOG_CTX);

export const HttpClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const [requestLog] = React.useState(() => new HttpRequestLog());
    const client = React.useMemo<HttpClient>(() => new RecordingHttpClient(isDesktopHost()
        ? new NativeHttpClient({ proxyEndpoint: new URL("dashql-native://localhost") }, logger)
        : new WebHttpClient(logger), requestLog), [logger, requestLog]);
    return (
        <REQUEST_LOG_CTX.Provider value={requestLog}>
            <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>
        </REQUEST_LOG_CTX.Provider>
    );
};
