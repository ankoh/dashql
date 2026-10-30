import { describe, expect, it, vi } from 'vitest';

import { AgentQuestionStore } from './agent_question_store.js';

const question = { question: 'how many rows', status: 'waiting for agent...', error: null, note: null, scripts: [] };

describe('AgentQuestionStore', () => {
    it('keeps the questions of every session apart', () => {
        const store = new AgentQuestionStore();
        const first = store.add('a', question);
        const second = store.add('b', { ...question, question: 'how many columns' });
        expect([...store.questions('a').keys()]).toEqual([first]);
        expect([...store.questions('b').values()].map(q => q.question)).toEqual(['how many columns']);
        expect(store.isWorking('a', second)).toBe(false);
        expect(store.finish('b', second)).toBe(true);
        expect(store.finish('b', second)).toBe(false);
    });
});
