import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentGreeting } from './agent_greeting.js';

describe('Agent greeting', () => {
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

    it('shows Wobble next to the question', () => {
        act(() => root.render(<AgentGreeting wobble={{ label: 'Agent' }} questionTestId="question" greetings={['Where do we start?']} />));
        expect(container.querySelector('svg[aria-label="Agent"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="question"]')?.getAttribute('aria-label')).toBe('Where do we start?');
    });
});
