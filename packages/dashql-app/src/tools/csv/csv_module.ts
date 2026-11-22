import { CsvSniffer } from '@akohn/csv-sniffer';

// The Wasm of the sniffer is an asset of @akohn/csv-sniffer, loaded when the page reads a file
import csvWasmUrl from '@akohn/csv-sniffer/wasm?url';
const CSV_WASM_URL = typeof csvWasmUrl === 'string' ? csvWasmUrl : new URL(csvWasmUrl as string, import.meta.url).href;

let loading: Promise<CsvSniffer> | null = null;

/// Load the CSV sniffer once, a failed load is tried again by the next call
export function loadCsvModule(): Promise<CsvSniffer> {
    loading ??= (async () => {
        const response = await fetch(CSV_WASM_URL);
        if (!response.ok) throw new Error(`Failed to fetch the CSV sniffer: ${response.status} ${response.statusText}`);
        return CsvSniffer.create({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
    })();
    loading.catch(() => {
        loading = null;
    });
    return loading;
}
