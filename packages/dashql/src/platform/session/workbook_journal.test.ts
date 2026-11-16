import { LogLevel, type LogKeyValues, type LogRecord } from '../platform/logger/log_buffer.js';
import { reduceAgentSessionJournal, createAgentSessionState } from './agent_session_state.js';
import {
    JOURNAL_FILES,
    JOURNAL_KEYS,
    JOURNAL_TARGET,
    journalScriptProgressMarker,
    journalScriptResultMarker,
    journalScriptStartedMarker,
    type JournalMarker,
    journalFilePaths,
    parseJournalLines,
    reduceJournalMarker,
} from './workbook_journal.js';

function record(message: string, keyValues: LogKeyValues, target = JOURNAL_TARGET): LogRecord {
    return { timestamp: 1, level: LogLevel.Info, target, message, context: null, tracing: null, keyValues };
}

const marker = (message: string, workbook: string, workbookId: string, keyValues: LogKeyValues = {}) =>
    record(message, { [JOURNAL_KEYS.workbook]: workbook, [JOURNAL_KEYS.workbookId]: workbookId, ...keyValues });

/// A record of a marker as a command logs it
const logged = (built: JournalMarker) => record(built.message, built.keyValues);

const ORDERS = { workbook: 'orders', workbookId: 'w1' };
const result = (script: string, rows: number) => logged(journalScriptResultMarker(ORDERS, { script, key: 'k'.repeat(64), rows, error: null, cached: false }));

describe('the journal of a session', () => {
    it('parses the lines that are records', () => {
        const files = marker(JOURNAL_FILES, '.', 'w1', { [JOURNAL_KEYS.files]: ['dashql-workbook.json', 'scripts/a.sql'] });
        const records = parseJournalLines(`${JSON.stringify(files)}\nnot json\n{"message":1}\n`);
        expect(records).toEqual([files]);
        expect(journalFilePaths(records[0])).toEqual(['dashql-workbook.json', 'scripts/a.sql']);
        expect(journalFilePaths(record('Executed query', {}, 'query_executor'))).toBeNull();
    });

    it('folds the markers: the files, the running script with its progress, the latest result of every script', () => {
        const stamped = [{ path: 'scripts/a.sql', size: 5, mtimeMs: 2 }];
        let workbooks = reduceJournalMarker([], marker(JOURNAL_FILES, 'orders', 'w1', { [JOURNAL_KEYS.files]: ['scripts/a.sql'] }), stamped);
        workbooks = reduceJournalMarker(workbooks, logged(journalScriptStartedMarker(ORDERS, 'a.sql')));
        expect(workbooks[0].running).toEqual({ script: 'a.sql', phase: null, percent: null, rows: null });
        workbooks = reduceJournalMarker(workbooks, logged(journalScriptProgressMarker(ORDERS, { script: 'a.sql', phase: 'RUNNING', percent: 41.6, rows: 1200 })));
        expect(workbooks[0].running).toEqual({ script: 'a.sql', phase: 'RUNNING', percent: 42, rows: 1200 });
        workbooks = reduceJournalMarker(workbooks, result('a.sql', 3));
        workbooks = reduceJournalMarker(workbooks, result('b.sql', 1));
        workbooks = reduceJournalMarker(workbooks, result('a.sql', 4));
        expect(workbooks).toHaveLength(1);
        expect(workbooks[0].files).toEqual(stamped);
        expect(workbooks[0].running).toBeNull();
        expect(workbooks[0].results.map(r => [r.script, r.rows, r.key != null, r.error, r.cached])).toEqual([['b.sql', 1, true, null, false], ['a.sql', 4, true, null, false]]);

        // Another folder is another workbook, a folder with another workbook starts over
        workbooks = reduceJournalMarker(workbooks, marker(JOURNAL_FILES, 'other', 'w2', { [JOURNAL_KEYS.files]: [] }));
        workbooks = reduceJournalMarker(workbooks, marker(JOURNAL_FILES, 'orders', 'w3', { [JOURNAL_KEYS.files]: [] }));
        expect(workbooks.map(w => [w.path, w.workbookId, w.results.length])).toEqual([['orders', 'w3', 0], ['other', 'w2', 0]]);
    });

    it('keeps the other records of the commands as the log of the session', () => {
        let state = createAgentSessionState('claude', '/w');
        state = reduceAgentSessionJournal(state, record('Executed query', { numRows: '25' }, 'query_executor'));
        state = reduceAgentSessionJournal(state, result('a.sql', 25));
        expect(state.log.map(r => r.message)).toEqual(['Executed query']);
        expect(state.workbooks[0].results).toHaveLength(1);
        expect(state.version).toBe(2);
    });
});
