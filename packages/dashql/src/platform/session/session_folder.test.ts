import { createAgentSessionState, reduceAgentSessionCopy } from './agent_session_state.js';
import { parseSessionConnections, sessionFolderPath, workbookCopyPath } from './session_folder.js';

describe('the folder of a session', () => {
    it('keeps the copies of the workbooks in the folder of the session', () => {
        expect(sessionFolderPath('s1')).toBe('.dashql/sessions/s1');
        expect(workbookCopyPath('s1', 'w1')).toBe('.dashql/sessions/s1/workbooks/w1');
        expect(() => sessionFolderPath('../x')).toThrow('invalid session name');
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
