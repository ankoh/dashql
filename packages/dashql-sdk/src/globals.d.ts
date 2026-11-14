// The SDK compiles without the DOM and without the types of Node, see docs/wip/dashql_sdk.md. These are the globals
// that browsers and Node both have and that the SDK uses. An API of only one platform fails the type check.

declare function queueMicrotask(callback: () => void): void;
declare function setTimeout(callback: () => void, delay?: number): unknown;
declare function clearTimeout(handle: unknown): void;

declare const console: {
    debug(...data: unknown[]): void;
    log(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
};
