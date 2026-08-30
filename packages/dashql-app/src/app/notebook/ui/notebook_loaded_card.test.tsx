import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpNotebookLoadResult } from '../persistence/http_notebook_bundle.js';
import { NotebookImportCard } from './notebook_import_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../../ui/navbar.js', () => ({ CompactNavBar: () => null }));
vi.mock('../../../ui/particle_flow/particle_flow_background.js', () => ({ ParticleFlowBackground: () => null }));

const RESULT: HttpNotebookLoadResult = {
    bundle: {
        notebook: {
            notebookId: '4f741f53-d76f-4a6d-b1d8-c22aa85bd449',
            name: 'Quarterly pipeline',
            connectionParams: { hyper: {} } as any,
            metadata: {
                originType: 'HTTP',
                originalHttpUrl: 'https://example.com/notebook/dashql-notebook.json',
            },
        },
        schemaSql: null,
        functionsSql: null,
        folders: [{ name: 'main', scripts: [{ name: 'query.sql', sql: 'SELECT 1' }] }],
        draftSql: null,
    },
    indexedScriptCount: 1,
    loadedScriptCount: 1,
    incomplete: false,
};

describe('NotebookImportCard ready state', () => {
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

    it('shows the notebook summary and imports', () => {
        const onImport = vi.fn();
        act(() => root.render(
            <NotebookImportCard
                phase="ready"
                result={RESULT}
                conflictLocation={null}
                conflictIsNative={false}
                busy={false}
                onImport={onImport}
                onReplace={() => {}}
                onCreateNew={() => {}}
                onClose={() => {}}
            />,
        ));

        expect(container.querySelector('h1')?.textContent).toBe('Import Notebook');
        expect(container.textContent).toContain('Quarterly pipeline');
        expect(container.textContent).toContain(RESULT.bundle.notebook.notebookId);
        expect(container.textContent).toContain(RESULT.bundle.notebook.metadata.originalHttpUrl);
        expect(container.querySelector('[role="status"]')).toBeNull();

        expect(container.textContent).toContain('1 script in 1 folder');
        const importButton = Array.from(container.querySelectorAll('button'))
            .find(candidate => candidate.textContent === 'Import') as HTMLButtonElement;
        act(() => importButton.click());
        expect(onImport).toHaveBeenCalledOnce();
    });

    it('warns when indexed scripts are unresolved', () => {
        const result = { ...RESULT, indexedScriptCount: 3, incomplete: true };
        act(() => root.render(
            <NotebookImportCard
                phase="ready"
                result={result}
                conflictLocation={null}
                conflictIsNative={false}
                busy={false}
                onImport={() => {}}
                onReplace={() => {}}
                onCreateNew={() => {}}
                onClose={() => {}}
            />,
        ));

        expect(container.querySelector('[role="status"]')?.textContent).toContain('could not be resolved');
        expect(container.textContent).toContain('1 of 3 scripts in 1 folder');
    });

    it('shows conflict choices immediately on the import card', () => {
        act(() => root.render(
            <NotebookImportCard
                phase="ready"
                result={RESULT}
                conflictLocation="Local notebooks / Sales"
                conflictIsNative={false}
                busy={false}
                onImport={() => {}}
                onReplace={() => {}}
                onCreateNew={() => {}}
                onClose={() => {}}
            />,
        ));

        expect(container.querySelector('[role="status"]')?.textContent).toContain('already exists');
        expect(container.textContent).toContain('Local notebooks / Sales');
        expect(container.textContent).not.toContain('Continue');
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Import')).toBe(false);
        expect(container.textContent).toContain('Replace');
        expect(container.textContent).toContain('Create New');
        expect(container.querySelector('button[aria-label="Close"]')).toBeInstanceOf(HTMLButtonElement);
    });

    it('clarifies that replacing a native collision preserves its files', () => {
        act(() => root.render(
            <NotebookImportCard
                phase="ready"
                result={RESULT}
                conflictLocation="fs:///Users/test/notebook"
                conflictIsNative
                busy={false}
                onImport={() => {}}
                onReplace={() => {}}
                onCreateNew={() => {}}
                onClose={() => {}}
            />,
        ));

        expect(container.textContent).toContain('Replacing removes the old notebook without overwriting existing native files.');
        expect(container.textContent).toContain('Existingfs:///Users/test/notebook');
    });
});
