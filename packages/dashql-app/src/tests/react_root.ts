import type * as React from 'react';
import { createRoot } from 'react-dom/client';

import { act } from './react_act.js';

/// A React root in a container attached to the document, for tests that render components
export function createTestRoot() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    return {
        container,
        render: (element: React.ReactNode) => act(() => root.render(element)),
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}
