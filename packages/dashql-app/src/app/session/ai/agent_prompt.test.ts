import { describe, expect, it } from 'vitest';

import { buildAgentPrompt, describeSqlDialect } from './agent_prompt.js';
import { ConnectorType } from '../../connections/connector_info.js';

describe('Agent prompt', () => {
    it('names the dialect and the dashql commands in the agent prompt', () => {
        const prompt = buildAgentPrompt({
            question: 'top customers\0',
            dialect: describeSqlDialect(ConnectorType.TRINO),
            mentionedIdentifiers: ['customers (table)'],
        });
        expect(prompt).toContain('The connection speaks Trino.');
        expect(prompt).toContain('`dashql agent scripts`');
        expect(prompt).toContain('`dashql agent edit <script>`, into a new script');
        expect(prompt).toContain('do not recap your steps');
        expect(prompt).toContain('The question mentions these catalog objects: customers (table).');
        expect(prompt.endsWith('\n\nQuestion:\ntop customers')).toBe(true);
    });
});
