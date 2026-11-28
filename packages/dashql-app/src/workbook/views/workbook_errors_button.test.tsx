import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { WorkbookErrorsButton, type WorkbookScriptErrors } from './workbook_errors_button.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SCRIPTS: WorkbookScriptErrors[] = [
    { scriptKey: 1, fileName: 'orders.sql', errors: 2, message: 'syntax error at or near "where"' },
    { scriptKey: 4, fileName: 'customers.sql', errors: 1, message: 'unknown script: order' },
];

describe('WorkbookErrorsButton', () => {
    let root: ReturnType<typeof createTestRoot>;

    beforeEach(() => {
        root = createTestRoot();
    });
    afterEach(() => root.unmount());

    const trigger = () => root.container.querySelector<HTMLButtonElement>('button[data-testid="workbook-errors"]');
    const list = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Workbook errors"]');

    it('renders nothing without errors', () => {
        root.render(<WorkbookErrorsButton workbookId="w" scripts={[]} showScript={() => {}} />);
        expect(root.container.innerHTML).toBe('');
    });

    it('counts the errors and shows a script of the list', () => {
        const showScript = vi.fn<(scriptKey: number) => void>();
        root.render(<WorkbookErrorsButton workbookId="w" scripts={SCRIPTS} showScript={showScript} />);
        expect(trigger()!.textContent).toBe('3');
        expect(trigger()!.getAttribute('aria-label')).toBe('Show 3 errors in 2 scripts');
        expect(list()).toBeNull();

        act(() => trigger()!.click());
        const items = [...list()!.querySelectorAll<HTMLButtonElement>('li button')];
        expect(items.map(item => item.textContent)).toEqual([
            'orderssyntax error at or near "where"2 errors',
            'customersunknown script: order',
        ]);

        act(() => items[1].click());
        expect(showScript).toHaveBeenCalledExactlyOnceWith(4);
        expect(list()).toBeNull();
    });

    it('closes the list when the errors are gone', () => {
        root.render(<WorkbookErrorsButton workbookId="w" scripts={SCRIPTS} showScript={() => {}} />);
        act(() => trigger()!.click());
        expect(list()).not.toBeNull();
        root.render(<WorkbookErrorsButton workbookId="w" scripts={[]} showScript={() => {}} />);
        expect(trigger()).toBeNull();
        expect(list()).toBeNull();
        // The list stays closed when the errors come back
        root.render(<WorkbookErrorsButton workbookId="w" scripts={SCRIPTS.slice(1)} showScript={() => {}} />);
        expect(trigger()!.getAttribute('aria-label')).toBe('Show 1 error in 1 script');
        expect(list()).toBeNull();
    });
});
