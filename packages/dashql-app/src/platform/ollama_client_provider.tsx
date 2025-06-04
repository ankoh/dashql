import * as React from 'react';

import { OllamaClient } from './ollama_client.js';
import { useHttpClient } from './http_client_provider.js';
import { useLogger } from './logger_provider.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<OllamaClient | null>(null);
export const useOllamaClient = () => React.useContext(CLIENT_CTX)!;

export const OllamaClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const httpClient = useHttpClient();
    const [client, setClient] = React.useState<OllamaClient | null>(null);
    React.useEffect(() => {
        if (logger != null && httpClient != null) {
            let client: OllamaClient = new OllamaClient(logger, httpClient);
            setClient(client);
        }
    }, [logger, httpClient]);
    return <CLIENT_CTX.Provider value={client}> {props.children}</CLIENT_CTX.Provider>;
};

