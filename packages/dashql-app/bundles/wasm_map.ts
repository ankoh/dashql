import webpack from 'webpack';
import * as fs from 'fs';

const PLUGIN_NAME = 'CopyWasmSourceMapPlugin';

class CopyWasmSourceMapPlugin {
    apply(compiler: webpack.Compiler) {
        const { Compilation, sources } = compiler.webpack;
        const logger = compiler.getInfrastructureLogger(PLUGIN_NAME);

        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
            compilation.hooks.processAssets.tap(
                { name: PLUGIN_NAME, stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
                (assets) => {
                    for (const [filename] of Object.entries(assets)) {
                        if (!filename.endsWith('.wasm')) continue;

                        const asset = compilation.getAsset(filename);
                        const info = asset?.info;
                        if (!info?.sourceFilename) {
                            logger.info(`skipping wasm file, since sourceFilename is empty: ${filename}`);
                            continue;
                        }

                        const relativeMapPath = `${info.sourceFilename}.map`;
                        if (!fs.existsSync(relativeMapPath)) {
                            logger.info(`wasm file missing sourcemap: file=${filename}, map=${relativeMapPath}`);
                            continue;
                        }

                        logger.info(`emitting asset sourcemap: file=${filename}, map=${relativeMapPath}`);
                        const buf = fs.readFileSync(relativeMapPath);
                        compilation.emitAsset(`${filename}.map`, new sources.RawSource(buf));
                    }
                }
            );
        });
    }
}

export default CopyWasmSourceMapPlugin;
