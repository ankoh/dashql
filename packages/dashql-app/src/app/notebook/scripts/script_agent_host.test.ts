import { describe, expect, it, vi } from 'vitest';

import { CREATE_SCRIPT_WITH_TEXT, REGISTER_AGENT_RUN, SET_SCRIPT_TEXT, type NotebookScripts } from './notebook_scripts.js';
import { createNotebookScriptsAgentHost } from './script_agent_host.js';

describe('V2 notebook script agent host', () => {
    function setup(contextScriptKey: number | null = 7) {
        const session = {};
        const createAgentSession = vi.fn(() => ({ destroy: vi.fn() }));
        const modifyNotebookScripts = vi.fn();
        const notebookScripts = {
            instance: { createAgentSession }, connectionCatalog: {},
            scripts: { 7: { scriptKey: 7, scriptSession: session } },
        } as unknown as NotebookScripts;
        return {
            host: createNotebookScriptsAgentHost({ notebookScripts, contextScriptKey, modifyNotebookScripts, contributors: [] }),
            createAgentSession, modifyNotebookScripts, session,
        };
    }

    it('creates sessions against the focused flat script', () => {
        const { host, createAgentSession, session } = setup();
        host.createAgentSession!();
        expect(createAgentSession).toHaveBeenCalledWith(expect.anything(), session, expect.anything());
    });

    it('replaces the focused script or inserts a new script', () => {
        const { host, modifyNotebookScripts } = setup();
        host.applyProposal('replace', 'SELECT 1');
        host.applyProposal('create', 'SELECT 2');
        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(1, {
            type: SET_SCRIPT_TEXT, value: { scriptKey: 7, text: 'SELECT 1', withDiff: true },
        });
        expect(modifyNotebookScripts).toHaveBeenNthCalledWith(2, {
            type: CREATE_SCRIPT_WITH_TEXT, value: { text: 'SELECT 2' },
        });
    });

    it('registers only runs with a focused script', () => {
        const focused = setup();
        focused.host.registerRun!(42);
        expect(focused.modifyNotebookScripts).toHaveBeenCalledWith({ type: REGISTER_AGENT_RUN, value: [7, 42] });
        const unfocused = setup(null);
        unfocused.host.registerRun!(42);
        expect(unfocused.modifyNotebookScripts).not.toHaveBeenCalled();
        expect(() => unfocused.host.applyProposal('replace', 'SELECT 1')).toThrow('missing focused target');
    });
});
