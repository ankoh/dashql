import {createRequire} from "node:module";

interface NativeAddon {
    health(): string;
    route(request: {
        body: Buffer;
        headers: string[][];
        method: string;
        url: string;
    }): Promise<{
        body: Buffer;
        headers: string[][];
        status: number;
        statusText: string;
    }>;
}

interface NativeRequestMessage {
    body: Uint8Array;
    headers: string[][];
    id: number;
    method: string;
    url: string;
}

const parentPort = process.parentPort;
if (parentPort === undefined) {
    throw new Error("Native utility worker must run as an Electron utility process");
}

const addonPath = process.env.DASHQL_NATIVE_ADDON;
if (addonPath === undefined) {
    throw new Error("DASHQL_NATIVE_ADDON is not set");
}

const require = createRequire(import.meta.url);
const addon = require(addonPath) as NativeAddon;

parentPort.postMessage({type: "ready"});

parentPort.on("message", (event) => {
    const request = event.data as Partial<NativeRequestMessage>;
    if (!Number.isSafeInteger(request.id) || !(request.body instanceof Uint8Array) ||
        !Array.isArray(request.headers) || typeof request.method !== "string" || typeof request.url !== "string") {
        parentPort.postMessage({error: "Invalid native proxy request", id: request.id});
        return;
    }
    Promise.resolve().then(() => addon.route({
        body: Buffer.from(request.body!),
        headers: request.headers!,
        method: request.method!,
        url: request.url!,
    })).then((response) => {
        const body = new Uint8Array(response.body);
        parentPort.postMessage({
            body,
            health: addon.health(),
            headers: response.headers,
            id: request.id!,
            status: response.status,
            statusText: response.statusText,
        });
    }).catch((error) => {
        parentPort.postMessage({
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            id: request.id!,
        });
    });
});
