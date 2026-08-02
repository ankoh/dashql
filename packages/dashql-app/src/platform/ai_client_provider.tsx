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

/// A provider block opts into AI; omitted fields use the defaults above. Keep an explicitly blank
/// endpoint as disabled so clearing the field in Settings remains a valid way to turn AI off.
export function isAIProviderConfigured(settings: AIProviderSettings | undefined): boolean {
    return settings != null && (settings.endpointUrl ?? DEFAULT_AI_ENDPOINT_URL).trim().length > 0;
}

export const AIClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const httpClient = useHttpClient();
    const config = useAppConfig();
    // Only expose a client once the user has an `aiProvider` block. Individual fields are optional
    // and resolve to defaults, so a provider that only overrides the model or headers is configured.
    const stored = config?.settings?.aiProvider;
    const configured = isAIProviderConfigured(stored);
    const settings = resolveAIClientSettings(stored);

    const client = React.useMemo<AIClient | null>(() => {
        if (logger == null || httpClient == null || !configured) return null;
        return new AIClient(logger, httpClient, settings);
    }, [logger, httpClient, configured, settings.endpointUrl, settings.model, settings.headers]);

    return <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>;
};
