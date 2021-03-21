fs = require('fs');
path = require('path');

dist = path.resolve(__dirname, 'dist');

function printErr(err) {
    if (err) return console.log(err);
}

fs.writeFile(path.join(dist, 'dashql_core.d.ts'), "export * from './types/src/index_web';", printErr);
fs.writeFile(path.join(dist, 'dashql_core_node.d.ts'), "export * from './types/src/index_node';", printErr);
