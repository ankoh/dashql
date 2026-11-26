import { describe, expect, it } from 'vitest';

import { isAgentConnectionAllowed } from './agent_connections.js';

describe('the connections of the agent', () => {
    it('allows only the connections of the workbook and the embedded Hyper until the user ticks or unticks one', () => {
        const used = ['trino'];
        const none = new Map<string, boolean>();
        expect(isAgentConnectionAllowed('trino', none, used, false)).toBe(true);
        expect(isAgentConnectionAllowed('other', none, used, false)).toBe(false);
        // The embedded Hyper also to a workbook that runs only on Trino
        expect(isAgentConnectionAllowed('hyper', none, used, true)).toBe(true);
        // What the user ticked wins over the default
        const choices = new Map([['trino', false], ['other', true], ['hyper', false]]);
        expect(isAgentConnectionAllowed('trino', choices, used, false)).toBe(false);
        expect(isAgentConnectionAllowed('other', choices, used, false)).toBe(true);
        expect(isAgentConnectionAllowed('hyper', choices, used, true)).toBe(false);
    });
});
