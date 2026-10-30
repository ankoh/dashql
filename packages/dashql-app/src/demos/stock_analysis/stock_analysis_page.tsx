import * as React from 'react';
import { Link } from 'react-router-dom';

import { stringifyError } from '../../platform/logger/logger.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { VegaLiteChart } from '../../ui/vegalite/vegalite_chart.js';
import { arrowTableToRows } from '../../ui/vegalite/vegalite_rows.js';
import { useDemoDataSource, type DemoDataSource } from '../shared/data_source.js';
import { bindSqlTemplate } from '../shared/sql_template.js';
import { useLiveQuery, type LiveQueryState } from '../shared/use_live_query.js';
import { BinanceFeed } from './binance_feed.js';
import { CoinbaseFeed } from './coinbase_feed.js';
import { formatChange, formatPrice, formatRatio, LiveBoard, readBoardRows, type BoardRow } from './live_board.js';
import { priceChartSpec, ROWS_DATASET, throughputChartSpec, WINDOW_END_SIGNAL, WINDOW_START_SIGNAL } from './stock_analysis_specs.js';
import { SyntheticFeed } from './synthetic_feed.js';
import { TickWriter, type TickFeed, type TickFeedStatus } from './tick_feed.js';
import * as styles from './stock_analysis_page.module.css';

import SCHEMA_SQL from './sql/schema.sql?raw';
import LIVE_BOARD_SQL from './sql/live_board.sql?raw';
import SYMBOL_CHART_SQL from './sql/symbol_chart.sql?raw';
import THROUGHPUT_SQL from './sql/throughput.sql?raw';
import STATS_SQL from './sql/stats.sql?raw';

const LOG_CTX = 'stock_analysis';

/// The time that the charts reach back
const CHART_WINDOW_MS = 5 * 60 * 1000;
/// The time that the throughput chart reaches back
const THROUGHPUT_WINDOW_MS = 60 * 1000;

/// The feeds of the HyperDB WASM of the page
type FeedKind = 'synthetic' | 'coinbase' | 'binance';
const FEEDS: { kind: FeedKind; label: string }[] = [
    { kind: 'synthetic', label: 'Synthetic' },
    { kind: 'coinbase', label: 'Coinbase' },
    { kind: 'binance', label: 'Binance' },
];

/// The rates of the synthetic feed in ticks per second
const RATES = [100, 1000, 10000];

/// The ingest of a feed into the HyperDB WASM of the page
interface IngestState {
    /// Does the table exist?
    ready: boolean;
    /// The state of the feed
    status: TickFeedStatus | null;
    /// The inserted ticks per second
    ticksPerSecond: number;
    /// The error of the latest failed statement
    error: string | null;
}

const NO_INGEST: IngestState = { ready: false, status: null, ticksPerSecond: 0, error: null };

/// Feed ticks into the table of the HyperDB WASM of the page
function useTickIngest(source: DemoDataSource | null, feedKind: FeedKind, rate: number): IngestState {
    const logger = useLogger();
    const [state, setState] = React.useState<IngestState>(NO_INGEST);
    const feed = React.useRef<TickFeed | null>(null);
    // The rate of a running synthetic feed changes without a restart
    const rateRef = React.useRef(rate);
    rateRef.current = rate;
    // The teardown of the previous feed, the next one starts after it so that no insert outlives the reset of the table
    const teardown = React.useRef<Promise<void>>(Promise.resolve());

    React.useEffect(() => {
        setState(NO_INGEST);
        if (source == null) return;
        let stopped = false;
        let writer: TickWriter | null = null;
        let rateTimer: ReturnType<typeof setInterval> | null = null;
        const connecting = (async () => {
            await teardown.current;
            if (stopped) return null;
            const conn = await source.database.connect();
            try {
                // Every feed starts with an empty table, the symbols of the feeds differ
                await conn.execute(SCHEMA_SQL);
                await conn.execute('delete from ticks');
            } catch (e) {
                await conn.close();
                throw e;
            }
            if (stopped) {
                await conn.close();
                return null;
            }
            writer = new TickWriter(conn, {
                onError: e => {
                    logger.warn('Inserting ticks failed', { error: stringifyError(e) }, LOG_CTX);
                    setState(s => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
                },
            });
            const active = feedKind === 'synthetic' ? new SyntheticFeed({ ticksPerSecond: rateRef.current })
                : feedKind === 'coinbase' ? new CoinbaseFeed()
                    : new BinanceFeed();
            feed.current = active;
            setState(s => ({ ...s, ready: true }));
            active.start(ticks => writer!.push(ticks), status => setState(s => ({ ...s, status })));
            let written = 0;
            rateTimer = setInterval(() => {
                // The updater runs later, it gets the rate and not the counters
                const ticksPerSecond = writer!.written - written;
                written = writer!.written;
                setState(s => ({ ...s, ticksPerSecond }));
            }, 1000);
            return conn;
        })();
        connecting.catch(e => {
            logger.error('Starting the feed failed', { error: stringifyError(e) }, LOG_CTX);
            setState(s => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
        });
        return () => {
            stopped = true;
            teardown.current = (async () => {
                if (rateTimer != null) clearInterval(rateTimer);
                feed.current?.stop();
                feed.current = null;
                const conn = await connecting.catch(() => null);
                await writer?.stop();
                await conn?.close();
            })();
        };
    }, [source, feedKind, logger]);

    React.useEffect(() => {
        if (feed.current instanceof SyntheticFeed) feed.current.ticksPerSecond = rate;
    }, [rate]);

    return state;
}

/// The current time, advanced once per period
function useNow(periodMs: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), periodMs);
        return () => clearInterval(timer);
    }, [periodMs]);
    return now;
}

/// The time of a query, e.g. 4ms
function formatLatency(state: LiveQueryState): string | null {
    return state.latencyMs == null ? null : `${state.latencyMs < 10 ? state.latencyMs.toFixed(1) : Math.round(state.latencyMs)}ms`;
}

interface PanelProps {
    title: string;
    /// The query of the panel, its time is shown next to the title
    query: LiveQueryState;
    className?: string;
    children: React.ReactNode;
    'data-testid'?: string;
}

/// A panel with the time of its query in the header and the error of the query in place of the content
const Panel: React.FC<PanelProps> = (props: PanelProps) => (
    <section className={`${styles.panel} ${props.className ?? ''}`} aria-label={props.title} data-testid={props['data-testid']}>
        <header className={styles.panel_header}>
            <h2 className={styles.panel_title}>{props.title}</h2>
            <span className={styles.panel_latency} title="Time of the latest query">{formatLatency(props.query)}</span>
        </header>
        {props.query.error != null && <p className={styles.panel_error}>{props.query.error.message}</p>}
        <div className={styles.panel_body}>{props.children}</div>
    </section>
);

/// A value of the header
const Stat: React.FC<{ label: string; value: React.ReactNode; 'data-testid'?: string }> = props => (
    <div className={styles.stat} data-testid={props['data-testid']}>
        <span className={styles.stat_label}>{props.label}</span>
        <span className={styles.stat_value}>{props.value}</span>
    </div>
);

const COUNT = new Intl.NumberFormat('en-US');

interface CardProps {
    /// The name of the card
    title: string;
    /// The headline value
    value: string;
    /// The values next to the headline
    detail?: React.ReactNode;
    /// The query of the chart, its error is shown in place of the chart
    query: LiveQueryState;
    /// The chart
    children: React.ReactElement;
    'data-testid'?: string;
}

/// A small card with a headline value and a chart under it
const Card: React.FC<CardProps> = (props: CardProps) => (
    <section className={styles.card} aria-label={props.title} data-testid={props['data-testid']}>
        <header className={styles.card_header}>
            <h2 className={styles.card_title}>{props.title}</h2>
        </header>
        <div className={styles.card_values}>
            <span className={styles.card_value} data-testid="card-value">{props.value}</span>
            {props.detail != null && <span className={styles.card_detail}>{props.detail}</span>}
        </div>
        {props.query.error != null
            ? <p className={styles.card_error}>{props.query.error.message}</p>
            : props.children}
    </section>
);

/// The direction class of a change in a card
function cardDirection(value: number | null): string | undefined {
    if (value == null || value === 0) return undefined;
    return value > 0 ? styles.up : styles.down;
}

/// Stock Analysis on Hyper: a live board of trades with charts of a symbol.
/// The HyperDB WASM of the page is fed by a generator or the public feeds of Coinbase or Binance.
export const StockAnalysisPage: React.FC = () => {
    const { source, error: sourceError } = useDemoDataSource();
    const [feedKind, setFeedKind] = React.useState<FeedKind>('synthetic');
    const [rate, setRate] = React.useState(1000);
    const ingest = useTickIngest(source, feedKind, rate);

    // The queries of the page wait for the table of the HyperDB WASM
    const database = source == null || !ingest.ready ? null : source.database;
    const board = useLiveQuery(database, LIVE_BOARD_SQL, 500);
    const throughput = useLiveQuery(database, THROUGHPUT_SQL, 1000);
    const stats = useLiveQuery(database, STATS_SQL, 1000);

    const rows = React.useMemo(() => board.table == null ? [] : readBoardRows(board.table), [board.table]);
    const [selected, setSelected] = React.useState<string | null>(null);
    // Without a selection, the chart shows the symbol with the most trades
    const busiest = rows.reduce<BoardRow | null>((best, row) => best == null || row.trades > best.trades ? row : best, null);
    const symbol = selected != null && rows.some(row => row.symbol === selected) ? selected : busiest?.symbol ?? null;
    const chartSql = React.useMemo(() => symbol == null ? null : bindSqlTemplate(SYMBOL_CHART_SQL, { symbol }), [symbol]);
    const chart = useLiveQuery(database, chartSql, 1000);

    const now = useNow(250);
    const priceData = React.useMemo(() => ({ [ROWS_DATASET]: chart.table == null ? [] : arrowTableToRows(chart.table) }), [chart.table]);
    const throughputData = React.useMemo(() => ({ [ROWS_DATASET]: throughput.table == null ? [] : arrowTableToRows(throughput.table) }), [throughput.table]);
    const priceSignals = React.useMemo(() => ({ [WINDOW_START_SIGNAL]: now - CHART_WINDOW_MS, [WINDOW_END_SIGNAL]: now }), [now]);
    const throughputSignals = React.useMemo(() => ({ [WINDOW_START_SIGNAL]: now - THROUGHPUT_WINDOW_MS, [WINDOW_END_SIGNAL]: now }), [now]);

    // The trades of the last full second, the current second is still filling up, and the mean of the window
    const trades = React.useMemo(() => {
        const rows = throughputData[ROWS_DATASET];
        if (throughput.table == null) return null;
        const lastSecond = Math.floor(Date.now() / 1000) * 1000 - 1000;
        const last = rows.find(row => row.t === lastSecond);
        const total = rows.reduce((sum, row) => sum + Number(row.trades), 0);
        return { last: last == null ? 0 : Number(last.trades), mean: total / (THROUGHPUT_WINDOW_MS / 1000) };
    }, [throughputData, throughput.table]);

    const statsRow = stats.table?.get(0);
    const selectedRow = rows.find(row => row.symbol === symbol) ?? null;

    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <div className={styles.title_row}>
                    <Link className={styles.back} to="/">Demos</Link>
                    <h1 className={styles.title}>Stock Analysis</h1>
                    <SegmentedControl aria-label="Feed" data-testid="feed-kind" size={SegmentedControlSize.Small} onChange={i => setFeedKind(FEEDS[i].kind)}>
                        {FEEDS.map(f => <SegmentedControl.Button key={f.kind} selected={f.kind === feedKind}>{f.label}</SegmentedControl.Button>)}
                    </SegmentedControl>
                    {feedKind === 'synthetic' && (
                        <SegmentedControl aria-label="Ticks per second" data-testid="feed-rate" size={SegmentedControlSize.Small} onChange={i => setRate(RATES[i])}>
                            {RATES.map(r => <SegmentedControl.Button key={r} selected={r === rate}>{`${COUNT.format(r)}/s`}</SegmentedControl.Button>)}
                        </SegmentedControl>
                    )}
                </div>
                <div className={styles.stats}>
                    <Stat label="Hyper" value={source?.version ?? '–'} />
                    <Stat label="Rows" value={statsRow == null ? '–' : COUNT.format(Number(statsRow['rows']))} data-testid="stat-rows" />
                    <Stat label="Symbols" value={statsRow == null ? '–' : COUNT.format(Number(statsRow['symbols']))} />
                    <Stat label="Ingest" value={`${COUNT.format(ingest.ticksPerSecond)}/s`} data-testid="stat-ingest" />
                    <Stat label="Feed" value={ingest.status == null ? '–' : `${ingest.status.state}${ingest.status.detail ? ` (${ingest.status.detail})` : ''}`} />
                </div>
                {(sourceError ?? ingest.error) != null && <p className={styles.error} role="alert">{sourceError ?? ingest.error}</p>}
            </header>
            <main className={styles.main}>
                <div className={styles.cards}>
                    <Card
                        title="Trades per second"
                        value={trades == null ? '–' : COUNT.format(trades.last)}
                        detail={trades == null ? null : `⌀ ${COUNT.format(Math.round(trades.mean))}/s over 60s`}
                        query={throughput}
                        data-testid="trades-card"
                    >
                        <VegaLiteChart className={styles.card_chart} spec={throughputChartSpec} datasets={throughputData} signals={throughputSignals} />
                    </Card>
                    <Card
                        title={symbol ?? 'Ticker'}
                        value={selectedRow == null ? '–' : formatPrice(selectedRow.last)}
                        detail={selectedRow == null ? null : (
                            <>
                                <span className={cardDirection(selectedRow.change)}>{formatChange(selectedRow.change)} ({formatRatio(selectedRow.changeRatio)})</span>
                                <span>Bid {formatPrice(selectedRow.bid)} · Ask {formatPrice(selectedRow.ask)}</span>
                            </>
                        )}
                        query={chart}
                        data-testid="ticker-card"
                    >
                        <VegaLiteChart className={styles.card_chart} spec={priceChartSpec} datasets={priceData} signals={priceSignals} />
                    </Card>
                </div>
                <Panel className={styles.table_panel} title="Tickers, last 30 minutes" query={board} data-testid="board-panel">
                    <LiveBoard rows={rows} selected={symbol} onSelect={setSelected} now={now} />
                </Panel>
            </main>
        </div>
    );
};

export default StockAnalysisPage;
