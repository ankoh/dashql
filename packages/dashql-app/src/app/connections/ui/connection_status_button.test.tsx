import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionHealth, type ConnectionState } from '../connection_state.js';
import { ConnectionStatusButton } from './connection_tree.js';
import * as styles from './connection_tree.module.css';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('Connection status button', () => {
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

    function render(health: ConnectionHealth, options: { usedHere?: boolean; attention?: boolean; onOpenSettings?: (anchor: HTMLButtonElement) => void } = {}) {
        const database = { connectionId: 'main', connectionHealth: health } as ConnectionState;
        act(() => root.render(
            <ConnectionStatusButton database={database} label="Hyper Local" usedHere={options.usedHere ?? true}
                attention={options.attention ?? false} onOpenSettings={options.onOpenSettings ?? vi.fn()} />,
        ));
        return container.querySelector<HTMLButtonElement>('button')!;
    }

    function dotFill(button: HTMLButtonElement): string | null {
        return button.querySelector<SVGElement>('[data-testid="connection-health-dot"] circle')?.style.fill || null;
    }

    it('shows the health without a label and opens the settings on click', () => {
        const onOpenSettings = vi.fn();
        const button = render(ConnectionHealth.NOT_STARTED, { onOpenSettings });
        const disconnectedLabel = button.getAttribute('aria-label');
        expect(disconnectedLabel).toContain('Hyper Local');
        expect(button.textContent).toBe('');
        const disconnectedFill = dotFill(button);
        expect(disconnectedFill).not.toBeNull();
        act(() => button.click());
        expect(onOpenSettings).toHaveBeenCalledWith(button);
        // Every health has its own color
        const onlineFill = dotFill(render(ConnectionHealth.ONLINE));
        const failedFill = dotFill(render(ConnectionHealth.FAILED));
        expect(new Set([disconnectedFill, onlineFill, failedFill]).size).toBe(3);
        // A connecting connection shows the running indicator instead of the dot
        const connecting = render(ConnectionHealth.CONNECTING);
        expect(connecting.getAttribute('aria-label')).toContain('Hyper Local');
        expect(connecting.getAttribute('aria-label')).not.toBe(disconnectedLabel);
        expect(connecting.querySelector('[data-testid="connection-health-dot"]')).toBeNull();
        expect(connecting.querySelector('svg')).not.toBeNull();
    });

    it('pulses only for offline connections of the current session', () => {
        expect(render(ConnectionHealth.NOT_STARTED, { attention: true }).getAttribute('data-connection-attention')).toBe('true');
        expect(render(ConnectionHealth.NOT_STARTED, { attention: false }).getAttribute('data-connection-attention')).toBeNull();
        expect(render(ConnectionHealth.ONLINE, { attention: true }).getAttribute('data-connection-attention')).toBeNull();
        expect(render(ConnectionHealth.NOT_STARTED, { attention: true, usedHere: false }).getAttribute('data-connection-attention')).toBeNull();
    });

    it('uses two finite attention pulses and a static spinner for reduced motion', () => {
        const rules = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules));
        const pulse = rules.find(rule => rule instanceof CSSStyleRule && rule.selectorText === `.${styles.database_status_attention}`) as CSSStyleRule;
        expect(pulse.style.animationIterationCount).toBe('2');
        const reduced = rules.find(rule => rule instanceof CSSMediaRule && rule.conditionText === '(prefers-reduced-motion: reduce)'
            && Array.from(rule.cssRules).some(child => child instanceof CSSStyleRule && child.selectorText === `.${styles.database_status_attention}`)) as CSSMediaRule;
        const attention = Array.from(reduced.cssRules).find(rule => rule instanceof CSSStyleRule && rule.selectorText === `.${styles.database_status_attention}`) as CSSStyleRule;
        expect(attention.style.animationName).toBe('none');
        expect(attention.style.backgroundColor).not.toBe('');
    });
});
