// ESLint with --fix on the sources of the workspace, the fixes of the rules of eslint.config.mjs written back:
// bazel run //bazel:eslint_fix [-- <paths relative to the workspace>]
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (workspace == null) {
    console.error('eslint_fix writes into the workspace, run it with bazel run //bazel:eslint_fix');
    process.exit(2);
}
const paths = process.argv.slice(2);
const eslint = new ESLint({
    cwd: workspace,
    fix: true,
    overrideConfigFile: fileURLToPath(new URL('../eslint.config.mjs', import.meta.url)),
});
const results = await eslint.lintFiles(paths.length > 0 ? paths : ['packages', 'tests/agents']);
await ESLint.outputFixes(results);
const formatter = await eslint.loadFormatter('stylish');
const report = await formatter.format(results);
if (report.length > 0) console.log(report);
const fixed = results.filter(result => result.output != null).length;
console.log(`eslint_fix: ${results.length} files, ${fixed} fixed`);
process.exit(results.some(result => result.errorCount > 0 || result.warningCount > 0) ? 1 : 0);
