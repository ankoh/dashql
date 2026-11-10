import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as Immutable from 'immutable';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRoot } from '../../tests/react_root.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';
import * as styles from './script_statistics_bar.module.css';

function reading(scannerNs: number, parserNs: number, analyzerNs: number, bytes: number) {
    // The memory of a reading is the sum of the rope, scanner, parser and analyzer bytes, the symbols and the size of
    // the name index are not counted
    return new dashql.buffers.editor.EditorProcessingStatisticsT(
        scannerNs, parserNs, analyzerNs,
        BigInt(bytes), 0n, 999n, 0n, 0n, 0n, 999n, 0n,
    );
}

describe('ScriptStatisticsBar', () => {
    let root: ReturnType<typeof createTestRoot>;

    beforeEach(() => {
        root = createTestRoot();
    });
    afterEach(() => root.unmount());

    const readings = () => [...root.container.querySelectorAll(`.${styles.metric_last_reading}`)].map(element => element.textContent);
    const names = () => [...root.container.querySelectorAll(`.${styles.metric_name}`)].map(element => element.textContent);
    const bars = (metric: number) => [...root.container.querySelectorAll(`.${styles.metric_history}`)[metric].children]
        .map(element => (element as HTMLElement).style.height);

    it('shows placeholders without statistics', () => {
        root.render(<ScriptStatisticsBar stats={null} className="custom" />);
        expect(readings()).toEqual(['- us', '- bytes']);
        expect(root.container.firstElementChild!.classList.contains('custom')).toBe(true);

        root.render(<ScriptStatisticsBar stats={Immutable.List()} />);
        expect(readings()).toEqual(['- us', '- bytes']);
        expect(root.container.querySelector(`.${styles.metric_history}`)).toBeNull();
    });

    it('shows the last reading of the memory and the three phases with their history', () => {
        const stats = Immutable.List([
            reading(500, 2_000_000, 3_000_000_000, 1500),
            reading(1_500, 4_000_000, 1_500_000_000, 3000),
        ]);
        root.render(<ScriptStatisticsBar stats={stats} />);
        expect(names()).toEqual(['M', 'S', 'P', 'A']);
        expect(readings()).toEqual(['3 kB', '2 us', '4.00 ms', '1.5 s']);

        // A history of 20 bars, the highest reading is at 1/1.2 of the height
        const memory = bars(0);
        expect(memory.length).toBe(20);
        expect(parseFloat(memory[0])).toBeCloseTo(100 / 1.2 / 2);
        expect(parseFloat(memory[1])).toBeCloseTo(100 / 1.2);
        expect(memory.slice(2).every(height => height === '0%')).toBe(true);
        expect(parseFloat(bars(1)[0])).toBeCloseTo(100 / 1.2 / 3);
        expect(parseFloat(bars(3)[0])).toBeCloseTo(100 / 1.2);
        expect(parseFloat(bars(3)[1])).toBeCloseTo(100 / 1.2 / 2);
    });

    it('draws at most the first 20 readings', () => {
        const stats = Immutable.List(Array.from({ length: 25 }, (_, i) => reading(i + 1, 1, 1, 100)));
        root.render(<ScriptStatisticsBar stats={stats} />);
        expect(bars(1).length).toBe(20);
        expect(readings()[1]).toBe('25.0 ns');
        expect(parseFloat(bars(1)[19])).toBeCloseTo(100 / 1.2);
    });
});
