import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { encodeNotebookAsZip } from './notebook_export.js';
import type { NotebookState } from './notebook_state.js';
import { STORAGE_SESSION_FILE } from '../platform/storage/storage_backend.js';

/// A minimal NotebookState carrying only the fields encodeNotebookAsZip reads. The scripts map is
/// empty and uncommittedScriptId points at nothing, so there is no draft/script content to encode —
/// the test only cares about the session metadata written into dashql-session.json.
function makeNotebookState(sessionId: string): NotebookState {
    return {
        sessionId,
        notebookMetadata: { originalFileName: 'notebook.sql' },
        notebookPages: {},
        scripts: {},
        uncommittedScriptId: -1,
    } as unknown as NotebookState;
}

async function readSessionData(zipBlob: Blob): Promise<any> {
    const zip = await JSZip.loadAsync(zipBlob);
    const sessionFile = zip.file(STORAGE_SESSION_FILE);
    expect(sessionFile).not.toBeNull();
    return JSON.parse(await sessionFile!.async('text'));
}

describe('encodeNotebookAsZip', () => {
    const connectionParams = { dataless: {} };

    it('writes the user-supplied session name so a shared link restores under the same label', async () => {
        const zipBlob = await encodeNotebookAsZip(makeNotebookState('uuid-1'), connectionParams, 'My Analysis');
        const session = await readSessionData(zipBlob);
        expect(session.name).toBe('My Analysis');
    });

    it('trims the session name before writing it', async () => {
        const zipBlob = await encodeNotebookAsZip(makeNotebookState('uuid-1'), connectionParams, '  Padded  ');
        const session = await readSessionData(zipBlob);
        expect(session.name).toBe('Padded');
    });

    it('omits the name entirely for an unnamed session (null)', async () => {
        const zipBlob = await encodeNotebookAsZip(makeNotebookState('uuid-1'), connectionParams, null);
        const session = await readSessionData(zipBlob);
        expect('name' in session).toBe(false);
    });

    it('omits the name for a blank (whitespace-only) name rather than writing an empty label', async () => {
        const zipBlob = await encodeNotebookAsZip(makeNotebookState('uuid-1'), connectionParams, '   ');
        const session = await readSessionData(zipBlob);
        expect('name' in session).toBe(false);
    });

    it('defaults to omitting the name when no name argument is passed', async () => {
        const zipBlob = await encodeNotebookAsZip(makeNotebookState('uuid-1'), connectionParams);
        const session = await readSessionData(zipBlob);
        expect('name' in session).toBe(false);
    });
});
