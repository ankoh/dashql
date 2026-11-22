import * as React from 'react';
import * as dashql from '@akohn/dashql';
import * as Immutable from 'immutable';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { formatNanoseconds } from '@akohn/dashql-react/format/format';
import { HISTORY_HEADROOM, HISTORY_LENGTH, ScriptStatisticsBar } from './script_statistics_bar.js';
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

        // A full history of bars, the highest reading below the headroom
        const top = 100 / HISTORY_HEADROOM;
        const memory = bars(0);
        expect(memory.length).toBe(HISTORY_LENGTH);
        expect(parseFloat(memory[0])).toBeCloseTo(top / 2);
        expect(parseFloat(memory[1])).toBeCloseTo(top);
        expect(memory.slice(2).every(height => height === '0%')).toBe(true);
        expect(parseFloat(bars(1)[0])).toBeCloseTo(top / 3);
        expect(parseFloat(bars(3)[0])).toBeCloseTo(top);
        expect(parseFloat(bars(3)[1])).toBeCloseTo(top / 2);
    });

    it('draws at most the first readings of a history', () => {
        const count = HISTORY_LENGTH + 5;
        const stats = Immutable.List(Array.from({ length: count }, (_, i) => reading(i + 1, 1, 1, 100)));
        root.render(<ScriptStatisticsBar stats={stats} />);
        expect(bars(1).length).toBe(HISTORY_LENGTH);
        expect(readings()[1]).toBe(formatNanoseconds(count));
        expect(parseFloat(bars(1)[HISTORY_LENGTH - 1])).toBeCloseTo(100 / HISTORY_HEADROOM);
    });
});
