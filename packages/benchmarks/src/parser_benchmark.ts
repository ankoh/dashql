import * as core from '../../core/build/libs/dashql-core-node.js';
import * as benny from 'benny';
import kleur from 'kleur';

function main(analyzer: core.analyzer.AnalyzerBindings) {
    let script = '';
    benny.suite(
        `Scripts`,
        benny.add('Demo script 1', () => {
            script = `
-- Test script for development.

INPUT country TYPE TEXT (
    default_value = 'DE'
);

FETCH weather_csv FROM http (
    url = format('https://cdn.dashql.com/demo/weather/{}', global.country)
);

LOAD weather FROM weather_csv USING CSV;

CREATE VIEW foo AS
    SELECT a1::INTEGER AS a, (random() * 100)::INTEGER AS b, (random() * 100)::INTEGER as c, (random() * 100)::INTEGER as d, (random() * 100)::INTEGER as e, (random() * 100)::INTEGER as f, (random() * 100)::INTEGER as g, (random() * 100)::INTEGER as h
    FROM generate_series(0, 1000000) AS a(a1);

VIZ foo USING LINE(
    title = 'Some Title',
    data = (x = a, y = b)
);
VIZ foo USING TABLE;
            `;
            analyzer.parseProgram(script);
        }),

        benny.cycle((result: any, _summary: any) => {
            const duration = result.details.median;
            const throughput = 1 / duration;
            const bytes = Buffer.byteLength(script);
            const byteThroughtput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} tp: ${core.utils.formatThousands(
                    throughput,
                )}/s dtp: ${core.utils.formatBytes(byteThroughtput)}/s`,
            );
        }),
    );
}

const analyzerBindings = new core.Analyzer({}, '../core/dist/dashql-analyzer.wasm');
analyzerBindings
    .init()
    .then(() => main(analyzerBindings))
    .catch(e => console.error(e));
