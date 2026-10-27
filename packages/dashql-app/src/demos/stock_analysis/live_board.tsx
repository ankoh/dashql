import type * as arrow from 'apache-arrow';
import * as React from 'react';

import * as styles from './live_board.module.css';

/// A row of the live board, see live_board.sql
export interface BoardRow {
    symbol: string;
    last: number;
    open: number;
    change: number;
    changeRatio: number | null;
    bid: number | null;
    ask: number | null;
    volume: number;
    trades: number;
    updatedMs: number;
}

/// A number of a row, null for null
function numberOf(row: any, field: string): number | null {
    const value = row[field];
    if (value == null) return null;
    return Number(value);
}

/// The rows of the result of live_board.sql
export function readBoardRows(table: arrow.Table): BoardRow[] {
    const rows: BoardRow[] = [];
    for (const row of table) {
        if (row == null) continue;
        rows.push({
            symbol: String(row['symbol']),
            last: numberOf(row, 'last') ?? 0,
            open: numberOf(row, 'open') ?? 0,
            change: numberOf(row, 'change') ?? 0,
            changeRatio: numberOf(row, 'change_ratio'),
            bid: numberOf(row, 'bid'),
            ask: numberOf(row, 'ask'),
            volume: numberOf(row, 'volume') ?? 0,
            trades: numberOf(row, 'trades') ?? 0,
            updatedMs: numberOf(row, 'updated_ms') ?? 0,
        });
    }
    return rows;
}

/// The decimals of a price: cents for prices above a dollar, 4 significant digits below
export function formatPrice(value: number | null): string {
    if (value == null) return '–';
    if (Math.abs(value) >= 1 || value === 0) {
        return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return value.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/// A change with its sign, the sign carries the direction next to the color
export function formatChange(value: number): string {
    const text = formatPrice(Math.abs(value));
    return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

export function formatRatio(value: number | null): string {
    if (value == null) return '–';
    const text = `${(Math.abs(value) * 100).toFixed(2)}%`;
    return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/// The time since an update, e.g. 120ms, 4.2s, 3m
function formatAge(ms: number): string {
    if (ms < 0) ms = 0;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m`;
    return `${Math.floor(ms / 3600000)}h`;
}

/// The direction class of a change
function directionClass(value: number | null): string | undefined {
    if (value == null || value === 0) return undefined;
    return value > 0 ? styles.up : styles.down;
}

interface Props {
    /// The rows of the board
    rows: readonly BoardRow[];
    /// The selected symbol
    selected: string | null;
    /// Select a symbol
    onSelect: (symbol: string) => void;
    /// The current time, for the age of the updates
    now: number;
}

/// The latest trade of every symbol. A price that changed flashes in the direction of the change.
export const LiveBoard: React.FC<Props> = (props: Props) => {
    // The previous price per symbol, for the direction of the flash
    const previous = React.useRef(new Map<string, number>());
    // The flashes belong to a result, the renders of the clock in between keep them
    const flashes = React.useMemo(() => {
        const flashes = new Map<string, number>();
        for (const row of props.rows) {
            const before = previous.current.get(row.symbol);
            if (before != null && before !== row.last) flashes.set(row.symbol, row.last - before);
        }
        return flashes;
    }, [props.rows]);
    React.useEffect(() => {
        previous.current = new Map(props.rows.map(row => [row.symbol, row.last]));
    }, [props.rows]);

    return (
        <table className={styles.board} data-testid="live-board">
            <thead>
                <tr>
                    <th className={styles.symbol_col}>Symbol</th>
                    <th>Last</th>
                    <th>Change</th>
                    <th>Change %</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Volume</th>
                    <th>Trades</th>
                    <th>Updated</th>
                </tr>
            </thead>
            <tbody>
                {props.rows.map(row => {
                    const flash = flashes.get(row.symbol);
                    return (
                        <tr
                            key={row.symbol}
                            className={row.symbol === props.selected ? styles.selected : undefined}
                            onClick={() => props.onSelect(row.symbol)}
                            aria-selected={row.symbol === props.selected}
                        >
                            <td className={styles.symbol_col}>{row.symbol}</td>
                            <td>
                                {/* A new key restarts the animation of the flash */}
                                <span key={row.last} className={flash == null ? undefined : flash > 0 ? styles.flash_up : styles.flash_down}>
                                    {formatPrice(row.last)}
                                </span>
                            </td>
                            <td className={directionClass(row.change)}>{formatChange(row.change)}</td>
                            <td className={directionClass(row.changeRatio)}>{formatRatio(row.changeRatio)}</td>
                            <td>{formatPrice(row.bid)}</td>
                            <td>{formatPrice(row.ask)}</td>
                            <td>{COMPACT.format(row.volume)}</td>
                            <td>{COMPACT.format(row.trades)}</td>
                            <td className={styles.age}>{formatAge(props.now - row.updatedMs)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};
