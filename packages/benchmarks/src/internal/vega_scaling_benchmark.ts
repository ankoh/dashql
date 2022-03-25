import Benchmark from 'buffalo-bench/lib';
import * as v from 'vega';
import * as vl from 'vega-lite';

const MAX_VALUE = 1000;
const TIME_BEGIN = new Date(Date.UTC(2022, 10, 16));
const TIME_END = new Date(Date.UTC(2022, 10, 21));
const VL_SPEC: vl.TopLevelSpec = {
    data: {
        name: "table"
    },
    mark: 'line',
    encoding: {
        x: {
            field: 'x',
            type: 'temporal',
            scale: {
                domain: [TIME_BEGIN.getTime(), TIME_END.getTime()],
            }
        },
        y: {
            field: 'y',
            type: 'quantitative',
            scale: {
                domain: [0.0, 1000.0],
            }
        }
    }
};

interface Row {
    x: number,
    y: number,
}

interface State {
    spec: v.Spec | null;
    parsed: v.Runtime | null;
    view: v.View | null;
    data: Row[];
};

function generateData(n: number): Row[] {
    const diff = TIME_END.getTime() - TIME_BEGIN.getTime();
    const step = diff - n;
    const rows = [];
    for (let i = 0; i < n; ++i) {
        const x = TIME_END.getTime() + i * step;
        const y = Math.random() * MAX_VALUE;
        rows.push({x, y});
    }
    return rows;
}

export function benchmarkVegaScaling(): Benchmark[] {
    const benches = [];
    for (const n of [1000, 5000, 10000, 25000, 50000, 75000, 100000, 250000, 500000]) {
        const state: State = {
            spec: null,
            parsed: null,
            view: null,
            data: [],
        };
        benches.push(
            new Benchmark(`vega_scaling_${n}`, {
                before: async () => {
                    const compiled = vl.compile(VL_SPEC)
                    state.spec = compiled.spec;
                    state.parsed = v.parse(state.spec);
                    state.view = new v.View(state.parsed, { renderer: 'none'});
                    state.data = generateData(n);
                },
                fn: async () => {
                    const view = state.view!;
                    view.data('table', state.data);
                    await view?.toCanvas(2.0);
                },
                after: () => {
                },
                onError: e => {
                    console.log(e);
                },
            }),
        );
    }
    return benches;
}
