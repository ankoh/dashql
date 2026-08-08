import { describe, expect, it, vi } from 'vitest';

import { logCoreStderr } from './core_provider.js';
import type { TracedLogger } from './platform/logger/logger.js';

describe('logCoreStderr', () => {
    it('logs Emscripten abort output as a warning', () => {
        const logger = {
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as TracedLogger;

        logCoreStderr(logger, 'Aborted()');

        expect(logger.warn).toHaveBeenCalledWith('Aborted()', {}, 'core');
        expect(logger.error).not.toHaveBeenCalled();
    });

    it.each([
        'core initialization failed',
        'Aborted(native code called abort())',
    ])('keeps diagnostic core stderr output at error severity: %s', (message) => {
        const logger = {
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as TracedLogger;

        logCoreStderr(logger, message);

        expect(logger.error).toHaveBeenCalledWith(message, {}, 'core');
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
