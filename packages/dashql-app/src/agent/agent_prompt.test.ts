import { describe, expect, it } from 'vitest';

import { buildAgentPrompt, describeSqlDialect } from './agent_prompt.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

describe('the prompt of a question for the agent', () => {
    it('names the dialect and the question, the guide holds the rules', () => {
        const prompt = buildAgentPrompt({
            question: 'top customers\0',
            dialect: describeSqlDialect(ConnectorType.TRINO),
            referencedScripts: [],
        });
        expect(prompt).toBe('New scripts run on a connection that speaks Trino unless you name another.\n\nQuestion:\ntop customers');
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
