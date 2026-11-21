import { createAgentSessionState, reduceAgentSessionCopy } from './agent_session_state.js';
import { parseSessionConnections, parseWorkspaceFile, workbookCopyPath } from './session_folder.js';

describe('the folder of a session', () => {
    it('keeps the copies of the workbooks in the folder of the session', () => {
        expect(workbookCopyPath('w1')).toBe('workbooks/w1');
        expect(() => workbookCopyPath('../x')).toThrow('invalid workbook id');
    });

    it('reads the workspace file with the session that runs there', () => {
        const session = { id: 's1', endpoint: 'http://127.0.0.1:1', token: 't' };
        expect(parseWorkspaceFile(JSON.stringify({ formatVersion: 1, session }))).toEqual({ formatVersion: 1, session });
        expect(parseWorkspaceFile('{"formatVersion":1}')).toEqual({ formatVersion: 1 });
        // The connections that the tab lets the agent use, once it told them
        const connections = [{ connectionId: 'c1', name: 'Trino' }];
        expect(parseWorkspaceFile(JSON.stringify({ formatVersion: 1, session: { ...session, connections } }))).toEqual({ formatVersion: 1, session: { ...session, connections } });
        expect(parseWorkspaceFile(JSON.stringify({ formatVersion: 1, session: { ...session, connections: [{ connectionId: 'c2' }] } })))
            .toEqual({ formatVersion: 1, session: { ...session, connections: [{ connectionId: 'c2', name: 'c2' }] } });
        // A session that is no session is left out, a file without a version is no workspace file
        expect(parseWorkspaceFile('{"formatVersion":1,"session":{"endpoint":"http://127.0.0.1:1","token":"t"}}')).toEqual({ formatVersion: 1 });
        expect(parseWorkspaceFile(JSON.stringify({ session }))).toBeNull();
        expect(parseWorkspaceFile('null')).toBeNull();
        expect(parseWorkspaceFile('not json')).toBeNull();
    });

    it('reads the connections that the agent may use', () => {
        expect(parseSessionConnections('{"connections":[{"connectionId":"c1","name":"Trino"},{"connectionId":"c2"},{"name":"x"}]}'))
            .toEqual({ connections: [{ connectionId: 'c1', name: 'Trino' }, { connectionId: 'c2', name: 'c2' }] });
        expect(parseSessionConnections('{}')).toBeNull();
        expect(parseSessionConnections('not json')).toBeNull();
    });

    it('sets and removes the stamps of a copy in the state', () => {
        const stamped = [{ path: 'scripts/a.sql', size: 5, mtimeMs: 2 }];
        let state = reduceAgentSessionCopy(createAgentSessionState('claude', '/w', 's1'), 'w1', stamped);
        state = reduceAgentSessionCopy(state, 'w2', []);
        state = reduceAgentSessionCopy(state, 'w1', []);
        expect(state.workbooks.map(workbook => [workbook.workbookId, workbook.files.length]).sort()).toEqual([['w1', 0], ['w2', 0]]);
        state = reduceAgentSessionCopy(state, 'w2', null);
        expect(state.workbooks.map(workbook => workbook.workbookId)).toEqual(['w1']);
        expect(state.version).toBe(4);
    });
});
