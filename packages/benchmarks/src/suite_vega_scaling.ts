import { benchmarkVegaScaling } from './internal';
import { runBenchmarks } from './suite';
import Benchmark from 'buffalo-bench/lib';
import { writeReport } from './setup';

async function main() {
    let suite: Benchmark[] = [];
    suite = suite.concat(benchmarkVegaScaling());
    const results = await runBenchmarks(suite);
    console.log(results);
    await writeReport(results, './benchmark_vega_scaling.json');
}

main();
