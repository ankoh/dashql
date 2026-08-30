import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KeyValueListBuilder } from './keyvalue_list.js';

describe('KeyValueListBuilder', () => {
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
        expect(inputs.map(input => input.getAttribute('aria-label'))).toEqual([
            'Engine Settings name 1',
            'Engine Settings value 1',
            'Engine Settings name 2',
            'Engine Settings value 2',
        ]);
    });
});
