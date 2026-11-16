import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashQLCoreProvider, useDashQLCoreSetup, type DashQLSetupFn } from './core_provider.js';
import { DashQL } from '@ankoh/dashql';
import { LoggerProvider } from '../platform/logger/logger_provider.js';

describe('DashQLCoreProvider setup', () => {
    let container: HTMLDivElement;
    let root: Root | null;
    let core: DashQL;
    let setup: DashQLSetupFn;

    function CaptureSetup() {
        setup = useDashQLCoreSetup();
        return null;
    }

    async function render() {
        await act(async () => root!.render(React.createElement(LoggerProvider, null,
            React.createElement(DashQLCoreProvider, {
                children: React.createElement(CaptureSetup),
            }),
        )));
    }

    function startSetup(context = 'test'): Promise<DashQL> {
        const pending = setup(context);
        // Keep cleanup rejections handled even if an assertion fails before awaiting setup.
        void pending.catch(() => {});
        return pending;
    }

    async function unmount() {
        await act(async () => {
            root?.unmount();
            root = null;
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        // Never retire the browser dashboard's shared Core instance during provider cleanup.
        core = Object.create(DashQL.prototype) as DashQL;
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([0])));
        vi.spyOn(DashQL, 'create').mockResolvedValue(core);
    });

    afterEach(async () => {
        try {
            await unmount();
        } finally {
            container.remove();
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });

    it('instantiates the core once for every caller', async () => {
        await render();
        expect(DashQL.create).not.toHaveBeenCalled();

        await act(async () => {
            const first = startSetup();
            const second = startSetup('concurrent caller');
            expect(await first).toBe(core);
            expect(await second).toBe(core);
            expect(await startSetup('later caller')).toBe(core);
        });

        expect(DashQL.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a setup after unmount', async () => {
        await render();
        await unmount();
        await expect(setup('after unmount')).rejects.toMatchObject({ name: 'AbortError' });
        expect(DashQL.create).not.toHaveBeenCalled();
    });

    it('rejects a core instantiation that completed after unmount', async () => {
        let resolveCore!: (instance: DashQL) => void;
        vi.mocked(DashQL.create).mockImplementationOnce(() => new Promise(resolve => { resolveCore = resolve; }));
        await render();
        const pending = startSetup();
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await act(async () => {
            await vi.waitFor(() => expect(DashQL.create).toHaveBeenCalledTimes(1));
        });

        await unmount();
        resolveCore(core);
        await rejected;
    });
});
