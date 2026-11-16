import { describe, expect, it } from 'vitest';

import { isAgentConnectionAllowed } from './agent_connections.js';

describe('the connections of the agent', () => {
    it('allows every connection but a cloud until the user ticks or unticks it', () => {
        const clouds = ['cloud'];
        const none = new Map<string, boolean>();
        expect(isAgentConnectionAllowed('trino', none, clouds)).toBe(true);
        expect(isAgentConnectionAllowed('cloud', none, clouds)).toBe(false);
        // What the user ticked wins over the default
        const choices = new Map([['trino', false], ['cloud', true]]);
        expect(isAgentConnectionAllowed('trino', choices, clouds)).toBe(false);
        expect(isAgentConnectionAllowed('cloud', choices, clouds)).toBe(true);
    });
});
