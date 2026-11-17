import { LogLevel, type LogKeyValues, type LogRecord } from '../logger/log_buffer.js';
import { reduceAgentSessionJournal, createAgentSessionState } from './agent_session_state.js';
import {
    JOURNAL_FILES,
    JOURNAL_KEYS,
    JOURNAL_TARGET,
    journalFilesMarker,
    journalFilePaths,
    parseJournalLines,
    reduceJournalMarker,
} from './workbook_journal.js';

function record(message: string, keyValues: LogKeyValues, target = JOURNAL_TARGET): LogRecord {
    return { timestamp: 1, level: LogLevel.Info, target, message, context: null, tracing: null, keyValues };
}

const marker = (message: string, workbook: string, workbookId: string, keyValues: LogKeyValues = {}) =>
    record(message, { [JOURNAL_KEYS.workbook]: workbook, [JOURNAL_KEYS.workbookId]: workbookId, ...keyValues });

const ORDERS = { workbook: 'orders', workbookId: 'w1' };

describe('the journal of a session', () => {
    it('parses the lines that are records', () => {
        const files = marker(JOURNAL_FILES, '.', 'w1', { [JOURNAL_KEYS.files]: ['dashql-workbook.json', 'scripts/a.sql'] });
        const records = parseJournalLines(`${JSON.stringify(files)}\nnot json\n{"message":1}\n`);
        expect(records).toEqual([files]);
        expect(journalFilePaths(records[0])).toEqual(['dashql-workbook.json', 'scripts/a.sql']);
        expect(journalFilePaths(record('Executed query', {}, 'query_executor'))).toBeNull();
    });

    it('folds the files of the workbook folders', () => {
        const stamped = [{ path: 'scripts/a.sql', size: 5, mtimeMs: 2 }];
        const built = journalFilesMarker(ORDERS, ['scripts/a.sql']);
        let workbooks = reduceJournalMarker([], record(built.message, built.keyValues), stamped);
        expect(workbooks).toEqual([{ path: 'orders', workbookId: 'w1', files: stamped }]);
        // Other markers change nothing
        expect(reduceJournalMarker(workbooks, marker('Script result', 'orders', 'w1'))).toEqual(workbooks);

        // Another folder is another workbook, a folder with another workbook takes its place
        workbooks = reduceJournalMarker(workbooks, marker(JOURNAL_FILES, 'other', 'w2', { [JOURNAL_KEYS.files]: [] }));
        workbooks = reduceJournalMarker(workbooks, marker(JOURNAL_FILES, 'orders', 'w3', { [JOURNAL_KEYS.files]: [] }));
        expect(workbooks.map(w => [w.path, w.workbookId, w.files.length])).toEqual([['orders', 'w3', 0], ['other', 'w2', 0]]);
    });

    it('keeps the other records of the commands as the log of the session', () => {
        let state = createAgentSessionState('claude', '/w');
        state = reduceAgentSessionJournal(state, record('Executed query', { numRows: '25' }, 'query_executor'));
        state = reduceAgentSessionJournal(state, marker(JOURNAL_FILES, 'orders', 'w1', { [JOURNAL_KEYS.files]: [] }));
        expect(state.log.map(r => r.message)).toEqual(['Executed query']);
        expect(state.workbooks).toHaveLength(1);
        expect(state.version).toBe(2);
    });
});
