import './dashql_node_setup';
import './dashql_wasm_setup';
import { createNodeBackend } from '../backend/node_backend';
import { createWasmBackend } from '../backend/wasm_backend';
import { Backend } from '../backend/backend';

const NODE_BACKEND = createNodeBackend();
const WASM_BACKEND = createWasmBackend();

export function testBackends(fn: (backend: Backend) => void): void {
    describe('node', () => {
        fn(NODE_BACKEND);
    });
    describe('wasm', () => {
        fn(WASM_BACKEND);
    });
}
