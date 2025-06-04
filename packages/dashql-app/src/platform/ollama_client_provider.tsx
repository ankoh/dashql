import * as React from 'react';

import { OllamaClient } from './ollama_client.js';
import { useHttpClient } from './http_client_provider.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<OllamaClient | null>(null);
export const useOllamaClient = () => React.useContext(CLIENT_CTX)!;

export const OllamaClientProvider: React.FC<Props> = (props: Props) => {
    const httpClient = useHttpClient();
    const [client, setClient] = React.useState<OllamaClient | null>(null);
    React.useEffect(() => {
        let client: OllamaClient = new OllamaClient(httpClient);
        setClient(client);
    }, []);
    return <CLIENT_CTX.Provider value={client}> {props.children}</CLIENT_CTX.Provider>;
};

