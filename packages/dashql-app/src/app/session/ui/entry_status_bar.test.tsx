import * as React from 'react';

import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryStatusBar, type EntryStatusBarDependencies } from './entry_status_bar.js';
import { EntryStatusKind } from './entry_status_model.js';
import { IndicatorStatus } from '../../../ui/foundations/status_indicator.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const dependencies: EntryStatusBarDependencies = {
    AnchoredOverlay: props => (
        <>
            {props.renderAnchor?.({
                'aria-expanded': props.open,
                'aria-haspopup': 'true',
                onClick: props.open ? () => props.onClose?.('anchor-click') : () => props.onOpen?.('anchor-click'),
            })}
            {props.open ? props.children : null}
        </>
    ),
};

describe('EntryStatusBar', () => {
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

    it('colors the indicator by status instead of inheriting the neutral bar color', () => {
        const renderIndicatorFill = (indicator: IndicatorStatus) => {
            act(() => root.render(
                <EntryStatusBar status={{ kind: EntryStatusKind.Query, indicator, message: 'status', traceId: null, errorDetail: null }} dependencies={dependencies} />,
            ));
            return container.querySelector('svg path')!.getAttribute('fill');
        };
        const succeeded = renderIndicatorFill(IndicatorStatus.Succeeded);
        const failed = renderIndicatorFill(IndicatorStatus.Failed);
        expect(succeeded).not.toBe('currentColor');
        expect(failed).not.toBe('currentColor');
        expect(succeeded).not.toBe(failed);
    });

    it('shows all known query error details in an anchored dialog', () => {
        act(() => root.render(
            <EntryStatusBar status={{
                kind: EntryStatusKind.Query,
                indicator: 2,
                message: 'relation does not exist',
                traceId: 42,
                errorDetail: {
                    message: 'relation does not exist',
                    queryId: 7,
                    details: { sqlState: '42P01' },
                },
            }} dependencies={dependencies} />,
        ));

        const trigger = container.querySelector<HTMLButtonElement>('[data-testid="error-details-toggle"]')!;
        expect(trigger).not.toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        act(() => trigger.click());

        const dialog = container.querySelector('[data-testid="error-details"]');
        expect(dialog).not.toBeNull();
        expect(dialog!.textContent).toContain('relation does not exist');
        expect(dialog!.textContent).toContain('42P01');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        const closeButton = dialog!.querySelector<HTMLButtonElement>('[data-testid="error-details-close"]');
        expect(closeButton).not.toBeNull();

        act(() => closeButton!.click());

        expect(container.querySelector('[data-testid="error-details"]')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not show the error detail button for non-error statuses', () => {
        act(() => root.render(
            <EntryStatusBar status={{
                kind: EntryStatusKind.Query,
                indicator: 1,
                message: 'Statement executed successfully',
                traceId: 42,
                errorDetail: null,
            }} dependencies={dependencies} />,
        ));

        expect(container.querySelector('[data-testid="error-details-toggle"]')).toBeNull();
    });
});
