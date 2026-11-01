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

    it('forgets a deleted session', () => {
        const store = new AgentQuestionStore();
        const listener = vi.fn();
        store.subscribe(listener);
        const questionId = store.add('a', question);
        store.setTurnId('a', questionId, 'turn-1');
        store.attach('a', { sessionScripts: vi.fn(), runScript: vi.fn(), followScript: vi.fn() });
        listener.mockClear();

        store.drop('a');
        expect(listener).toHaveBeenCalledOnce();
        expect(store.questions('a').size).toBe(0);
        expect(store.isWorking('a', questionId)).toBe(false);
        expect(store.turnId('a', questionId)).toBeNull();
        expect(store.feed('a')).toBeNull();
        // The turn of the deleted session finishes without bringing it back
        expect(store.finish('a', questionId)).toBe(false);
        store.update('a', questionId, q => ({ ...q, status: null }));
        store.remove('a', questionId);
        expect(store.questions('a').size).toBe(0);
    });
});
