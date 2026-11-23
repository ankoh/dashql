import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';

import { defaultAgentConnectionIds, isAgentConnectionAllowed } from './agent_connections.js';

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

    it('allows the embedded Hyper by default, also to a workbook that runs only on Trino', () => {
        const connections = new Map([
            ['trino', { connectionId: 'trino', embedded: false } as ConnectionState],
            ['hyper', { connectionId: 'hyper', embedded: true } as ConnectionState],
            ['other', { connectionId: 'other', embedded: false } as ConnectionState],
        ]);
        const defaults = defaultAgentConnectionIds(connections, [['trino'], ['trino']]);
        expect(defaults).toEqual(['hyper', 'trino']);
        expect(isAgentConnectionAllowed('hyper', new Map(), defaults)).toBe(true);
        expect(isAgentConnectionAllowed('other', new Map(), defaults)).toBe(false);
        // The user can untick it
        expect(isAgentConnectionAllowed('hyper', new Map([['hyper', false]]), defaults)).toBe(false);
        // An app without the embedded Hyper yet
        expect(defaultAgentConnectionIds(new Map([['trino', connections.get('trino')!]]), [['trino']])).toEqual(['trino']);
    });
});
