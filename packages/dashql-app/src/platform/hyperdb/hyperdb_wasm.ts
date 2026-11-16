// The embedded database over hyperdb-wasm lives in the runtime, the app and the command line tool share it. The app
// loads the browser build of the engine.
export * from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
export { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
