import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpSessionLoadResult } from '../persistence/http_session_bundle.js';
import { SessionImportCard, type SessionImportCardDependencies } from './session_import_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const dependencies: SessionImportCardDependencies = {
    CompactNavBar: () => <></>,
    ParticleFlowBackground: () => null,
};

const RESULT: HttpSessionLoadResult = {
    bundle: {
        session: {
            formatVersion: 7,
            sessionId: '11111111-2222-4333-8444-555555555555',
            name: 'Flat session',
            defaultConnectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            connections: [{ connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', params: { hyper: {} } as any }],
            scripts: [{ name: '01_query.sql', connectionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }],
            attachments: [],
            metadata: { originType: 'HTTP', originalHttpUrl: 'https://example.com/dashql-session.json' },
        },
        catalogs: [],
        scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
    },
    listedScriptCount: 1,
    loadedScriptCount: 1,
    incomplete: false,
};

describe('SessionImportCard V2 ready state', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    it('summarizes flat scripts and starts import', () => {
        const onImport = vi.fn();
        act(() => root.render(<SessionImportCard phase="ready" result={RESULT} conflictLocation={null}
            conflictIsNative={false} busy={false} onImport={onImport} onReplace={() => {}}
            onCreateNew={() => {}} onClose={() => {}} dependencies={dependencies} />));
        expect(container.textContent).toContain('Flat session');
        expect(container.querySelector('[data-testid="session-import-incomplete"]')).toBeNull();
        expect(container.querySelector('[data-testid="session-import-conflict"]')).toBeNull();
        const button = container.querySelector('[data-testid="session-import-confirm"]') as HTMLButtonElement;
        act(() => button.click());
        expect(onImport).toHaveBeenCalledOnce();
    });

    it('surfaces incomplete index state and native replacement safety', () => {
        act(() => root.render(<SessionImportCard phase="ready" result={{ ...RESULT, listedScriptCount: 3, incomplete: true }}
            conflictLocation="/tmp/native" conflictIsNative busy={false} onImport={() => {}} onReplace={() => {}}
            onCreateNew={() => {}} onClose={() => {}} dependencies={dependencies} />));
        expect(container.querySelector('[data-testid="session-import-incomplete"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="session-import-conflict"]')?.hasAttribute('data-native')).toBe(true);
        expect(container.textContent).toContain('/tmp/native');
        expect(container.querySelector('[data-testid="session-import-confirm"]')).toBeNull();
        expect(container.querySelector('[data-testid="session-import-replace"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="session-import-create-new"]')).not.toBeNull();
    });
});
