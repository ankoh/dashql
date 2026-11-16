import { tableFromArrays } from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { ReportStyle } from '@ankoh/dashql-platform/sql/sql_report';

import type { RunEvent } from './run_events.js';
import { LiveRunReporter } from './run_live.js';
import { clipLine, compactCount, visibleLength } from './term.js';

/// A screen that understands what the live view writes: text, new lines, the lines up and the erase to the end
class Screen {
    lines: string[] = [''];
    private row = 0;
    cursorHidden = false;

    write(text: string): void {
        // eslint-disable-next-line no-control-regex
        const parts = text.split(/(\x1b\[[0-9;?]*[A-Za-z]|\n)/);
        for (const part of parts) {
            if (part === '') continue;
            if (part === '\n') {
                ++this.row;
                if (this.row === this.lines.length) this.lines.push('');
            } else if (part === '\x1b[?25l') {
                this.cursorHidden = true;
            } else if (part === '\x1b[?25h') {
                this.cursorHidden = false;
            } else if (/^\x1b\[\d+F$/.test(part)) {
                this.row = Math.max(0, this.row - Number(part.slice(2, -1)));
            } else if (part === '\x1b[J') {
                this.lines.length = this.row + 1;
                this.lines[this.row] = '';
            } else if (/^\x1b\[[0-9;]*m$/.test(part)) {
                // Colors
            } else if (part.startsWith('\x1b[')) {
                throw new Error(`unexpected escape ${JSON.stringify(part)}`);
            } else {
                this.lines[this.row] += part;
            }
        }
    }

    /// The lines on the screen, without the empty line of the cursor
    text(): string {
        return this.lines.join('\n').replace(/\n$/, '');
    }
}

/// A live reporter on a screen with a clock that the test moves
function live(columns = 60) {
    const screen = new Screen();
    let now = 0;
    const reporter = new LiveRunReporter(text => screen.write(text), { columns: () => columns }, new ReportStyle(false), 2, '/work', () => now, false);
    const send = (...events: RunEvent[]) => { for (const event of events) reporter.event(event); };
    return { screen, reporter, send, at: (ms: number) => { now = ms; } };
}

describe('the live view of dashql run', () => {
    it('shows what runs and what waits below what settled', () => {
        const { screen, send, at } = live();
        send({ type: 'run_started', workbook: 'tpch', scripts: ['a.sql', 'b.sql', 'c.sql'] });
        expect(screen.text()).toBe('dashql run tpch · 3 scripts\n⠋ planning');
        send({ type: 'connection_setup', connection: 'trino http://t:8080' });
        at(300);
        send(
            { type: 'connection_ready', connection: 'trino http://t:8080', ms: 300 },
            { type: 'script_planned', script: 'a.sql', follows: [] },
            { type: 'script_planned', script: 'b.sql', follows: [] },
            { type: 'script_planned', script: 'c.sql', follows: ['a.sql', 'b.sql'] },
            { type: 'script_started', script: 'a.sql' },
        );
        at(2300);
        send({ type: 'script_progress', script: 'a.sql', phase: 'RUNNING', percent: 50, rows: 1_234_567 });
        expect(screen.text()).toBe(`dashql run tpch · 3 scripts
✓ trino http://t:8080  ready  0.3 s
⠇ a.sql  RUNNING  ██████░░░░░░  50%  1.2M rows  2.0 s
· b.sql  queued
· c.sql  waits for a.sql, b.sql`);
        send({
            type: 'script_done', script: 'a.sql', ms: 2000, cached: false, key: 'k', file: '/work/.dashql/cache/k.parquet',
            table: tableFromArrays({ n: Int32Array.from([1, 2, 3]) }),
        });
        expect(screen.text()).toBe(`dashql run tpch · 3 scripts
✓ trino http://t:8080  ready  0.3 s
✓ a.sql  3 rows  2.0 s
  n Int32
  n
  -
  1
  2
  … 1 more
  .dashql/cache/k.parquet
· b.sql  queued
· c.sql  waits for b.sql`);
    });

    it('ends with the failures and a summary, the cursor back', () => {
        const { screen, send, reporter } = live();
        send(
            { type: 'run_started', workbook: 'w', scripts: ['a.sql', 'b.sql'] },
            { type: 'script_planned', script: 'a.sql', follows: [] },
            { type: 'script_started', script: 'a.sql' },
            { type: 'script_failed', script: 'a.sql', ms: 800, error: "line 1:8: Column 'x' cannot be resolved", statement: 'select x from t' },
            { type: 'script_not_run', script: 'b.sql', reason: 'the run stopped' },
            { type: 'run_finished', ms: 900, ok: 0, failed: 1, cancelled: 0, notRun: 1, interrupted: false },
        );
        reporter.close();
        expect(screen.cursorHidden).toBe(false);
        expect(screen.text()).toBe(`dashql run w · 2 scripts
✗ a.sql  failed  0.8 s
  line 1:8: Column 'x' cannot be resolved
  │ select x from t
  │        ^
⊘ b.sql  not run  the run stopped

1 failed · 1 not run · 0.9 s`);
    });

    it('keeps the lines of the region in the width of the terminal', () => {
        const { screen, send } = live(24);
        send(
            { type: 'run_started', workbook: 'w', scripts: ['a_script_with_a_long_name.sql'] },
            { type: 'script_planned', script: 'a_script_with_a_long_name.sql', follows: [] },
            { type: 'script_started', script: 'a_script_with_a_long_name.sql' },
        );
        const region = screen.text().split('\n').slice(1);
        expect(region).toEqual(['⠋ a_script_with_a_long…']);
    });

    it('counts the lines that don\'t fit', () => {
        const { screen, send } = live();
        const scripts = Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, '0')}.sql`);
        send({ type: 'run_started', workbook: 'w', scripts });
        for (const script of scripts) send({ type: 'script_planned', script, follows: [] });
        const region = screen.text().split('\n').slice(1);
        expect(region).toHaveLength(12);
        expect(region[11]).toBe('  … 9 more');
    });
});

describe('the text of a terminal', () => {
    it('measures and cuts text with escape sequences', () => {
        expect(visibleLength('\x1b[32m✓\x1b[39m ok')).toBe(4);
        expect(clipLine('\x1b[32mabcdef\x1b[39m', 4)).toBe('\x1b[32mabc…\x1b[0m');
        expect(clipLine('abc', 4)).toBe('abc');
    });

    it('counts large numbers in a few characters', () => {
        expect([950, 1234, 12_345, 1_234_567, 98_765_432, 2_500_000_000].map(compactCount)).toEqual(['950', '1.2k', '12k', '1.2M', '99M', '2.5G']);
    });
});
