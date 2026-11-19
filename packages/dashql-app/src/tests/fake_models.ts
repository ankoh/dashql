import { vi } from 'vitest';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';

import type { ScriptModel, ScriptModelSource } from '../runtime/models/script_model.js';

/// A script as the tests of components need it: its key, its file name, its text and nothing that runs
export function fakeScript(scriptKey: number, fileName: string, text = 'SELECT 1', overrides: Partial<ScriptData> = {}): ScriptData {
    return {
        scriptKey, fileName, workbookId: 'workbook', connectionId: 'database', scriptSession: { getText: () => text },
        analysisOutdated: true, annotations: {}, statistics: [], pendingDiff: null, latestQueryId: null, cachedResult: null,
        ...overrides,
    } as unknown as ScriptData;
}

/// A model of a script without a runtime: its operations are spies that resolve at once
export function fakeScriptModel(overrides: Partial<ScriptModel> = {}): ScriptModel {
    return {
        workbookId: 'workbook',
        script: fakeScript(1, 'script.sql'),
        query: null,
        runActive: false,
        run: vi.fn(async () => { }),
        cancel: vi.fn(async () => { }),
        setText: vi.fn(async () => { }),
        acceptDiff: vi.fn(async () => { }),
        rejectDiff: vi.fn(async () => { }),
        setVisSpec: vi.fn(async () => { }),
        ...overrides,
    };
}

/// A source of fake models by script key, for the components that resolve their models themselves, e.g. the rows of the
/// feed. A script without a model of the test gets a fake model of the script.
export function fakeScriptModels(models: Map<number, ScriptModel>, scripts: { [scriptKey: number]: ScriptData } = {}): ScriptModelSource {
    return {
        useScriptModel: (workbookId, scriptKey) => {
            if (scriptKey == null) return null;
            const model = models.get(scriptKey);
            if (model != null) return model;
            const script = scripts[scriptKey];
            if (script == null) return null;
            const created = fakeScriptModel({ workbookId, script });
            models.set(scriptKey, created);
            return created;
        },
    };
}
