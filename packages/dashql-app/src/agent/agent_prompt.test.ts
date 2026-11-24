import { describe, expect, it } from 'vitest';

import { buildAgentPrompt, describeSqlDialect } from './agent_prompt.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

describe('the prompt of a question for the agent', () => {
    it('names the dialect and the dashql commands', () => {
        const prompt = buildAgentPrompt({
            question: 'top customers\0',
            dialect: describeSqlDialect(ConnectorType.TRINO),
            referencedScripts: [],
        });
        expect(prompt).toContain('speaks Trino');
        expect(prompt).toContain('`dashql scripts`');
        expect(prompt).toContain('`dashql edit <script>`, into a new script');
        expect(prompt).toContain('do not recap your steps');
        expect(prompt.endsWith('\n\nQuestion:\ntop customers')).toBe(true);
        expect(prompt).not.toContain('targets these scripts');
    });

    it('names the scripts that the question targets', () => {
        const prompt = buildAgentPrompt({
            question: 'filter :revenue to 2024',
            dialect: describeSqlDialect(null),
            referencedScripts: ['revenue'],
        });
        expect(prompt).toContain('Tableau Hyper');
        expect(prompt).toContain('The question targets these scripts, referenced as :<script>: revenue. Work on them instead of writing a new script.');
    });
});
