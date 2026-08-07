import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
    check: vi.fn(),
}));

import { type DownloadEvent } from '@tauri-apps/plugin-updater';

import { InstallableTauriUpdate } from './native_version_check.js';
import { InstallationState, InstallationStatusSetter, InstallationStatusCode } from './version_check.js';

function createUpdate() {
    let emitProgress: ((event: DownloadEvent) => void) | null = null;
    let resolveInstallation: (() => void) | null = null;
    let rejectInstallation: ((error: Error) => void) | null = null;
    const update = {
        downloadAndInstall: vi.fn((callback: (event: DownloadEvent) => void) => {
            emitProgress = callback;
            return new Promise<void>((resolve, reject) => {
                resolveInstallation = resolve;
                rejectInstallation = reject;
            });
        }),
    };
    return {
        update,
        emit(event: DownloadEvent) {
            emitProgress?.(event);
        },
        resolve() {
            resolveInstallation?.();
        },
        reject(error: Error) {
            rejectInstallation?.(error);
        },
    };
}

describe('InstallableTauriUpdate', () => {
    it('only enables relaunch after Tauri finishes installing the download', async () => {
        const tauriUpdate = createUpdate();
        const captured = { state: null as InstallationState | null };
        const setState = (setter: InstallationStatusSetter) => {
            captured.state = typeof setter === 'function' ? setter(captured.state) : setter;
        };
        const update = new InstallableTauriUpdate(tauriUpdate.update as any, setState, {} as any);

        const installation = update.download();
        tauriUpdate.emit({ event: 'Started', data: { contentLength: 42 } });
        tauriUpdate.emit({ event: 'Finished' });

        expect(captured.state?.statusCode).toBe(InstallationStatusCode.InProgress);
        expect(captured.state?.loadedBytes).toBe(42);

        tauriUpdate.resolve();
        await installation;

        expect(captured.state?.statusCode).toBe(InstallationStatusCode.RestartPending);
    });

    it('does not enable relaunch when installation fails after downloading', async () => {
        const tauriUpdate = createUpdate();
        const captured = { state: null as InstallationState | null };
        const setState = (setter: InstallationStatusSetter) => {
            captured.state = typeof setter === 'function' ? setter(captured.state) : setter;
        };
        const update = new InstallableTauriUpdate(tauriUpdate.update as any, setState, {} as any);

        const installation = update.download();
        tauriUpdate.emit({ event: 'Started', data: { contentLength: 42 } });
        tauriUpdate.emit({ event: 'Finished' });
        tauriUpdate.reject(new Error('signature verification failed'));
        await installation;

        expect(captured.state?.statusCode).toBe(InstallationStatusCode.Failed);
        expect(captured.state?.error?.message).toBe('signature verification failed');
    });
});
