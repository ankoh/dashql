import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { SessionInputCard } from './session_input_card.js';
import type { SessionInput } from './session_inputs.js';

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

function intervalInput(value: string | null): SessionInput {
    return {
        name: 'span',
        type: { kind: core.buffers.analyzer.SqlTypeKind.INTERVAL, sql: 'interval', arrayDimensions: 0, withTimeZone: false, cast: false, known: true },
        value,
        literal: value == null ? null : `interval '${value.split(' ')[0]}' ${value.split(' ')[1]}`,
        consumers: [],
        warnings: [],
    };
}

/// The literal of a draft like the core makes it, a number and a unit
function literalOf(_input: SessionInput, value: string): { literal: string } | { error: string } {
    const match = /^(-?\d+) (year|month|day|hour|minute|second)$/.exec(value);
    return match == null ? { error: `no interval: ${value}` } : { literal: `interval '${match[1]}' ${match[2]}` };
}

describe('SessionInputCard', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onCommit = vi.fn();

    beforeEach(() => {
        onCommit.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    const render = (input: SessionInput) => act(() => root.render(<SessionInputCard input={input} literalOf={literalOf} onCommit={onCommit} />));
    const amount = () => container.querySelector<HTMLInputElement>('input[aria-label="Value of :span"]')!;
    const unit = () => container.querySelector<HTMLSelectElement>('select[aria-label="Unit of :span"]')!;

    it('edits an interval as a number and a unit', () => {
        render(intervalInput('3 day'));
        expect(amount().value).toBe('3');
        expect(unit().value).toBe('day');

        // A changed unit writes the value at once
        act(() => setSelectValue(unit(), 'hour'));
        expect(onCommit).toHaveBeenLastCalledWith('span', "interval '3' hour");

        // A changed amount is written with Enter
        act(() => setInputValue(amount(), '1 2'));
        expect(amount().value).toBe('12');
        act(() => { amount().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(onCommit).toHaveBeenLastCalledWith('span', "interval '12' hour");
    });

    it('keeps the unit of an interval without an amount', () => {
        render(intervalInput(null));
        expect(amount().value).toBe('');
        expect(unit().value).toBe('day');
        act(() => setSelectValue(unit(), 'minute'));
        expect(onCommit).not.toHaveBeenCalled();
        act(() => setInputValue(amount(), '5'));
        act(() => { amount().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(onCommit).toHaveBeenLastCalledWith('span', "interval '5' minute");
    });
});
