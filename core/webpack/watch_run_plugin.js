'use strict';

class WatchRunPlugin {
    apply(compiler) {
        compiler.hooks.watchRun.tap('WatchRun', (comp) => {
            if (comp.modifiedFiles) {
                const changedFiles = Array.from(comp.modifiedFiles, (file) => `\n  ${file}`).join('');
                console.log('===============================');
                console.log('FILES CHANGED:', changedFiles);
                console.log('===============================');
            }
        });
    }
}

module.exports = WatchRunPlugin;
