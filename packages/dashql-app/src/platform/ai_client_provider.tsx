import * as React from 'react';

import { AIClient, AIClientSettings } from './ai_client.js';
import { useHttpClient } from './http/http_client_provider.js';
import { useLogger } from './logger/logger_provider.js';
import {
    AIProviderSettings,
    DEFAULT_AI_ENDPOINT_URL,
    DEFAULT_AI_MODEL,
    useAppConfig,
} from '../app_config.js';

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<AIClient | null>(null);
export const useAIClient = () => React.useContext(CLIENT_CTX);

export function resolveAIClientSettings(settings: AIProviderSettings | undefined): AIClientSettings {
    return {
        endpointUrl: settings?.endpointUrl ?? DEFAULT_AI_ENDPOINT_URL,
        model: settings?.model ?? DEFAULT_AI_MODEL,
        headers: settings?.headers ?? [],
    };
}

export const AIClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const httpClient = useHttpClient();
    const config = useAppConfig();
    // Only expose a client once the user has actually configured an AI provider. The app ships
    // without an `aiProvider` block, so a missing endpoint means "not configured" — in that case
    // useAIClient() stays null, which is how AI-mode features (Switch Mode, the agent loop) gate
    // themselves. We key off the raw stored endpoint rather than the resolved settings so the
    // localhost default doesn't make AI look configured when it isn't.
    const stored = config?.settings?.aiProvider;
    const configured = (stored?.endpointUrl ?? '').trim().length > 0;
    const settings = resolveAIClientSettings(stored);

    const client = React.useMemo<AIClient | null>(() => {
        if (logger == null || httpClient == null || !configured) return null;
        return new AIClient(logger, httpClient, settings);
    }, [logger, httpClient, configured, settings.endpointUrl, settings.model, settings.headers]);

    return <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>;
};
