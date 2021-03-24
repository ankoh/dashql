import esbuild from 'esbuild';

const benchmarks = ['iterator_benchmark', 'parser_benchmark', 'proxy_benchmark'];

for (const benchmark of benchmarks) {
    console.log(`[ ESBUILD ] ${benchmark}.js`);
    esbuild.build({
        entryPoints: [`./src/${benchmark}.ts`],
        outfile: `dist/${benchmark}.js`,
        platform: 'node',
        format: 'cjs',
        target: 'es2020',
        bundle: true,
        minify: false,
    });
}
