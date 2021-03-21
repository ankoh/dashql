fs = require('fs');
path = require('path');

dist = path.resolve(__dirname, 'dist');

function printErr(err) {
    if (err) return console.log(err);
}

fs.writeFile(path.join(dist, 'crossworker.d.ts'), "export * from './types/src/crossworker';", printErr);
fs.writeFile(path.join(dist, 'webdb.d.ts'), "export * from './types/src/index_web';", printErr);
fs.writeFile(path.join(dist, 'webdb_async.d.ts'), "export * from './types/src/index_async';", printErr);
fs.writeFile(path.join(dist, 'webdb_async.worker.d.ts'), "export * from './types/src/worker_web';", printErr);
fs.writeFile(path.join(dist, 'webdb_node.d.ts'), "export * from './types/src/index_node';", printErr);
fs.writeFile(path.join(dist, 'webdb_node_async.worker.d.ts'), "export * from './types/src/worker_node';", printErr);
