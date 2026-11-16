import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql';

import { QueryType } from '@ankoh/dashql/platform/query/query_execution_state';
import { useShellQueryResult } from './use_shell_query_result.js';
import { RuntimeContextProvider } from '../runtime/runtime_hooks.js';
import { runTestQuery } from '../tests/test_connections.js';
import { testShellHistory, type TestShellHistory } from '../tests/test_shell_history.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// Run a query of the shell to its end, returns its id
function runShellQuery(history: TestShellHistory, n: number): number {
    return runTestQuery(history.runtime, history.connectionId, `SELECT ${n}`, {
        queryType: QueryType.USER_PROVIDED,
        title: 'Shell Query',
        description: null,
        issuer: 'DashQL Shell',
        userProvided: true,
    }, true);
}

describe('useShellQueryResult', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('keeps the computation of the open result after its query left the history', () => {
        const history = testShellHistory(dql);
        const first = runShellQuery(history, 1);

        let result!: ReturnType<typeof useShellQueryResult>;
        const release = vi.fn<(queryId: number) => void>();
        const Harness = () => {
            result = useShellQueryResult(release);
            return null;
        };
        act(() => root.render(<RuntimeContextProvider value={history.runtime}><Harness /></RuntimeContextProvider>));
        act(() => result.showResultQuery(first));
        expect(result.resultQuery?.queryId).toBe(first);

        // A reset of the connection clears its history
        act(() => {
            history.runtime.dispatch({ connection: history.connectionId }, { kind: 'resetConnection' });
            history.runtime.flush();
        });

        // The view of the query left with the history, its computation stays until another result replaces it
        expect(history.queries().some(query => query.queryId === first)).toBe(false);
        expect(release).not.toHaveBeenCalled();

        act(() => result.closeResultQuery());
        expect(result.resultQuery).toBeNull();
        let reopened = false;
        act(() => { reopened = result.reopenResultQuery(); });
        expect(reopened).toBe(true);
        expect(release).not.toHaveBeenCalled();
    });

    describe('with two results', () => {
        let result: ReturnType<typeof useShellQueryResult>;
        let release: ReturnType<typeof vi.fn<(queryId: number) => void>>;
        let ids: number[];

        beforeEach(() => {
            const history = testShellHistory(dql);
            ids = [1, 2].map(n => runShellQuery(history, n));
            release = vi.fn<(queryId: number) => void>();
            const Harness = () => {
                result = useShellQueryResult(release);
                return null;
            };
            act(() => root.render(<RuntimeContextProvider value={history.runtime}><Harness /></RuntimeContextProvider>));
        });

        it('has nothing to open again before the first result', () => {
            let reopened = true;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(false);
            expect(result.resultQuery).toBeNull();
        });

        it('keeps a closed result until the next one replaces it', () => {
            act(() => result.showResultQuery(ids[0]));
            act(() => result.closeResultQuery());
            expect(result.resultQuery).toBeNull();
            expect(release).not.toHaveBeenCalled();

            let reopened = false;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(true);
            expect(result.resultQuery?.queryId).toBe(ids[0]);

            act(() => result.showResultQuery(ids[1]));
            expect(result.resultQuery?.queryId).toBe(ids[1]);
            expect(release.mock.calls).toEqual([[ids[0]]]);
        });

        it('releases a dropped result and does not open it again', () => {
            act(() => result.showResultQuery(ids[0]));
            act(() => result.dropResultQuery());
            expect(result.resultQuery).toBeNull();
            expect(release.mock.calls).toEqual([[ids[0]]]);

            let reopened = true;
            act(() => { reopened = result.reopenResultQuery(); });
            expect(reopened).toBe(false);
        });

        it('releases the result with the page', () => {
            act(() => result.showResultQuery(ids[1]));
            act(() => root.render(<div />));
            expect(release.mock.calls).toEqual([[ids[1]]]);
        });
    });
});
