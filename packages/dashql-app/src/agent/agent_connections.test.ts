import { describe, expect, it } from 'vitest';

import { isAgentConnectionAllowed } from './agent_connections.js';

describe('the connections of the agent', () => {
    it('allows only the connections of the workbooks until the user ticks or unticks one', () => {
        const used = ['trino'];
        const none = new Map<string, boolean>();
        expect(isAgentConnectionAllowed('trino', none, used)).toBe(true);
        expect(isAgentConnectionAllowed('hyper', none, used)).toBe(false);
        // What the user ticked wins over the default
        const choices = new Map([['trino', false], ['hyper', true]]);
        expect(isAgentConnectionAllowed('trino', choices, used)).toBe(false);
        expect(isAgentConnectionAllowed('hyper', choices, used)).toBe(true);
    });
});
