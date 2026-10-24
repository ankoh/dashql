import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

import { KeyValueListBuilder } from './keyvalue_list.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';

describe('KeyValueListBuilder', () => {
    let container: HTMLDivElement;
    let root: Root;
    const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        writeText.mockClear();
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders immutable entries without mutation controls', () => {
        act(() => root.render(
            <KeyValueListBuilder
                title="Engine Settings"
                caption="Embedded engine initialization settings"
                keyIcon={() => <div>Name</div>}
                valueIcon={() => <div>Value</div>}
                addButtonLabel="Add Setting"
                elements={[
                    { key: 'identifier_resolution', value: 'case_insensitive' },
                    { key: 'log_file_max_count', value: '10' },
                ]}
                modifyElements={() => {}}
                disabled
                readOnly
            />,
        ));

        const inputs = [...container.querySelectorAll('input')];
        expect(inputs.map(input => input.value)).toEqual([
            'identifier_resolution',
            'case_insensitive',
            'log_file_max_count',
            '10',
        ]);
        expect(inputs.every(input => input.readOnly && input.disabled)).toBe(true);
        expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
        expect(container.querySelector('button')).toBeNull();
        const labels = inputs.map(input => input.getAttribute('aria-label') ?? '');
        expect(labels.every(label => label.length > 0)).toBe(true);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it('copies an optional formatted setting argument', async () => {
        await act(async () => root.render(
            <LoggerProvider>
                <KeyValueListBuilder
                    title="Engine Settings"
                    caption="Embedded engine initialization settings"
                    keyIcon={() => <div>Name</div>}
                    valueIcon={() => <div>Value</div>}
                    addButtonLabel="Add Setting"
                    elements={[{ key: 'identifier_resolution', value: 'case_insensitive' }]}
                    modifyElements={() => {}}
                    disabled
                    readOnly
                    sideBySide
                    copyValue={({ key, value }) => `--${key}=${value}`}
                    copyLogContext="test"
                />
            </LoggerProvider>,
        ));

        await act(async () => {
            container.querySelector<HTMLButtonElement>('[role="listitem"] [data-testid="keyvalue-copy"]')!.click();
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledWith('--identifier_resolution=case_insensitive');
    });
});
