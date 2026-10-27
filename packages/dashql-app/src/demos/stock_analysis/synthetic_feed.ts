import type { Tick, TickFeed, TickFeedStatus } from './tick_feed.js';

/// A symbol of the generator with its price at the start
interface SyntheticSymbol {
    symbol: string;
    price: number;
    /// The volatility per year, as in the Black-Scholes model
    volatility: number;
}

/// The symbols of the generator, prices roughly as of 2025
export const SYNTHETIC_SYMBOLS: readonly SyntheticSymbol[] = [
    { symbol: 'AAPL', price: 230, volatility: 0.25 },
    { symbol: 'MSFT', price: 420, volatility: 0.22 },
    { symbol: 'NVDA', price: 140, volatility: 0.5 },
    { symbol: 'GOOGL', price: 170, volatility: 0.3 },
    { symbol: 'AMZN', price: 190, volatility: 0.32 },
    { symbol: 'META', price: 560, volatility: 0.38 },
    { symbol: 'TSLA', price: 250, volatility: 0.6 },
    { symbol: 'AVGO', price: 170, volatility: 0.45 },
    { symbol: 'AMD', price: 150, volatility: 0.5 },
    { symbol: 'NFLX', price: 700, volatility: 0.35 },
    { symbol: 'CRM', price: 290, volatility: 0.33 },
    { symbol: 'ORCL', price: 170, volatility: 0.3 },
    { symbol: 'ADBE', price: 500, volatility: 0.3 },
    { symbol: 'INTC', price: 22, volatility: 0.45 },
    { symbol: 'QCOM', price: 160, volatility: 0.35 },
    { symbol: 'JPM', price: 220, volatility: 0.22 },
    { symbol: 'V', price: 290, volatility: 0.18 },
    { symbol: 'MA', price: 500, volatility: 0.2 },
    { symbol: 'WMT', price: 80, volatility: 0.16 },
    { symbol: 'KO', price: 65, volatility: 0.14 },
    { symbol: 'PEP', price: 165, volatility: 0.15 },
    { symbol: 'DIS', price: 95, volatility: 0.28 },
    { symbol: 'NKE', price: 80, volatility: 0.32 },
    { symbol: 'XOM', price: 115, volatility: 0.24 },
];

/// The seconds of a trading year, the unit of the volatility
const SECONDS_PER_YEAR = 252 * 6.5 * 3600;
/// The volatility is exaggerated, a real one barely moves the board within minutes
const VOLATILITY_SCALE = 8;

/// A pseudo random generator of numbers in [0, 1), the same for the same seed (mulberry32)
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/// The options of the generator
export interface SyntheticFeedOptions {
    /// The seed of the random numbers
    seed?: number;
    /// The ticks per second
    ticksPerSecond?: number;
    /// The time between two deliveries
    emitIntervalMs?: number;
    /// The time that the first delivery reaches back, so that the charts start with a history
    backfillMs?: number;
}

/// Trades of made-up prices: a geometric random walk per symbol, with more trades for the first symbols
export class SyntheticFeed implements TickFeed {
    /// The random numbers
    private readonly random: () => number;
    /// The current price per symbol
    private readonly prices: number[];
    /// The time of the latest tick per symbol
    private readonly symbolTs: (number | null)[];
    /// The cumulative weights of the symbols, the first symbols trade more often
    private readonly weights: number[];
    /// The time of the latest tick
    private lastTs: number | null = null;
    /// The ticks that are due but not delivered yet, as a fraction
    private carry = 0;
    /// The timer of the deliveries
    private timer: ReturnType<typeof setInterval> | null = null;

    /// The ticks per second, a change applies to the next delivery
    ticksPerSecond: number;
    private readonly emitIntervalMs: number;
    private readonly backfillMs: number;

    constructor(options: SyntheticFeedOptions = {}) {
        this.random = seededRandom(options.seed ?? 42);
        this.ticksPerSecond = options.ticksPerSecond ?? 1000;
        this.emitIntervalMs = options.emitIntervalMs ?? 50;
        this.backfillMs = options.backfillMs ?? 5 * 60 * 1000;
        this.prices = SYNTHETIC_SYMBOLS.map(s => s.price);
        this.symbolTs = SYNTHETIC_SYMBOLS.map(() => null);
        let total = 0;
        this.weights = SYNTHETIC_SYMBOLS.map((_, i) => (total += 1 / (i + 1)));
        this.weights = this.weights.map(w => w / total);
    }

    /// A normally distributed random number (Box-Muller)
    private normal(): number {
        const u = 1 - this.random();
        const v = this.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /// The index of a random symbol by the weights
    private pickSymbol(): number {
        const r = this.random();
        const index = this.weights.findIndex(w => r < w);
        return index < 0 ? this.weights.length - 1 : index;
    }

    /// Generate the ticks from the latest one up to a time, spread evenly over that time
    generate(count: number, untilMs: number): Tick[] {
        const from = this.lastTs ?? untilMs;
        const ticks: Tick[] = [];
        for (let i = 0; i < count; ++i) {
            const ts = count === 1 ? untilMs : from + ((untilMs - from) * (i + 1)) / count;
            const s = this.pickSymbol();
            const dtSeconds = Math.max((ts - (this.symbolTs[s] ?? ts)) / 1000, 0.001);
            this.symbolTs[s] = ts;
            const sigma = SYNTHETIC_SYMBOLS[s].volatility * VOLATILITY_SCALE * Math.sqrt(dtSeconds / SECONDS_PER_YEAR);
            const price = Math.round(this.prices[s] * Math.exp(sigma * this.normal()) * 100) / 100;
            this.prices[s] = Math.max(price, 0.01);
            const halfSpread = Math.max(0.01, Math.round(this.prices[s] * 0.0001 * (1 + this.random()) * 100) / 100);
            ticks.push({
                symbol: SYNTHETIC_SYMBOLS[s].symbol,
                ts: Math.round(ts),
                price: this.prices[s],
                size: Math.max(1, Math.round(Math.exp(3 + 1.2 * this.normal()))),
                bid: Math.round((this.prices[s] - halfSpread) * 100) / 100,
                ask: Math.round((this.prices[s] + halfSpread) * 100) / 100,
            });
            this.lastTs = ts;
        }
        return ticks;
    }

    start(emit: (ticks: Tick[]) => void, onStatus: (status: TickFeedStatus) => void): void {
        this.stop();
        const now = Date.now();
        if (this.lastTs == null && this.backfillMs > 0) {
            // The history at a tenth of the rate, so that it does not take long to insert
            this.lastTs = now - this.backfillMs;
            emit(this.generate(Math.round((this.ticksPerSecond / 10) * (this.backfillMs / 1000)), now));
        }
        this.lastTs = now;
        onStatus({ state: 'live' });
        let last = now;
        this.timer = setInterval(() => {
            const at = Date.now();
            this.carry += (this.ticksPerSecond * (at - last)) / 1000;
            last = at;
            const count = Math.floor(this.carry);
            this.carry -= count;
            if (count > 0) emit(this.generate(count, at));
        }, this.emitIntervalMs);
    }

    stop(): void {
        if (this.timer != null) clearInterval(this.timer);
        this.timer = null;
    }
}
