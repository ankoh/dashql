import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_ENDPOINT_URL, DEFAULT_AI_MODEL } from '../../../config/app_config.js';
import { resolveAIClientSettings } from './ai_client_provider.js';

describe('resolveAIClientSettings', () => {
    it('returns null until AI is explicitly enabled', () => {
        expect(resolveAIClientSettings(undefined)).toBeNull();
        expect(resolveAIClientSettings({})).toBeNull();
        expect(resolveAIClientSettings({ enabled: false, endpointUrl: 'https://example.com' })).toBeNull();
    });

    it('uses provider defaults when AI is enabled', () => {
        expect(resolveAIClientSettings({ enabled: true })).toEqual({
            endpointUrl: DEFAULT_AI_ENDPOINT_URL,
            model: DEFAULT_AI_MODEL,
            headers: [],
        });
    });

    it('preserves custom provider settings when AI is enabled', () => {
        const headers = [{ name: 'Authorization', value: 'Bearer token' }];
        expect(resolveAIClientSettings({
            enabled: true,
            endpointUrl: 'https://example.com',
            model: 'custom-model',
            headers,
        })).toEqual({
            endpointUrl: 'https://example.com',
            model: 'custom-model',
            headers,
        });
    });
});
