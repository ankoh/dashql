/// The document of an overlay, see docs/design/overlay.md. The core reads the signatures of the same document.

/// An option of a function or an attribute of a schema
export interface OverlayAttribute {
    /// The name in a script
    name: string;
    /// The spelling of the API, the name if absent
    wire?: string;
    /// Options only: `path:<placeholder>`, `query`, `header`, `body` or `body:root`
    in?: string;
    /// The type of a scalar
    type?: string;
    /// The schema of an object
    schema?: string;
    /// Is the option required?
    required?: boolean;
    /// Query options with arrays or objects, `repeat` by default
    style?: 'repeat' | 'csv' | 'deep';
    /// Path options whose value may contain `/`
    multi_segment?: boolean;
}

/// A named object
export interface OverlaySchema {
    attributes?: OverlayAttribute[];
}

/// A result column
export interface OverlayColumn {
    /// The name in a script
    name: string;
    /// The spelling of the API, the name if absent
    wire?: string;
    /// VARCHAR, TIMESTAMPTZ, DATE, INTEGER, BIGINT, DOUBLE, BOOLEAN or JSON
    type?: string;
}

/// When a list of pages ends
export type OverlayPagingEnd = 'empty_page' | 'short_page' | { total: string } | { has_more: string };

/// How a function pages
export interface OverlayPaging {
    kind: 'url' | 'token' | 'offset' | 'page';
    /// Where the value is: `/pointer`, `header:Link#next`, `header:<name>` or `last_row:/pointer`
    from?: string;
    /// The option that takes the value
    option?: string;
    /// The option with the page size
    size?: string;
    /// The first offset or page
    start?: number;
    /// When the list ends
    end?: OverlayPagingEnd;
}

/// How a function answers before it finishes
export interface OverlayPending {
    /// The status that means not finished
    status: number;
    /// `header:<name>` with the URL to poll, or `same` to repeat the request
    poll: string;
}

/// How a function reports errors
export interface OverlayErrors {
    /// JSON pointers to try for the error message
    message?: string[];
    /// A pointer that fails the statement when it's present, for a 200 that carries errors
    error_if?: string;
    /// The statuses that mean an empty result
    empty_on?: number[];
    /// Is the message a JSON string?
    message_is_json?: boolean;
}

/// A function of an overlay
export interface OverlayFunction {
    name: string;
    method?: string;
    host?: string;
    path?: string;
    options?: OverlayAttribute[];
    /// The format of the body: `json` by default, `form`, or a media type
    body?: string;
    rows?: string;
    columns?: OverlayColumn[];
    paging?: OverlayPaging;
    /// Overrides the default of the overlay, null for none
    pending?: OverlayPending | null;
    errors?: OverlayErrors;
    effect?: 'read' | 'write';
    /// The escape hatch: takes `method`, `path`, `host` and `body`
    raw?: boolean;
}

/// A host that functions name, the binding of the connection resolves it
export interface OverlayHost {
    base_path?: string;
}

/// An overlay
export interface OverlaySpec {
    format: number;
    namespace: string;
    hosts?: Record<string, OverlayHost>;
    errors?: OverlayErrors;
    pending?: OverlayPending | null;
    schemas?: Record<string, OverlaySchema>;
    functions: OverlayFunction[];
}

/// A value that the runtime fills in
export interface OverlayCallBinding {
    /// A JSON pointer into the options
    pointer: string;
    /// The name of a parameter
    param?: string;
    /// The name of a secret
    secret?: string;
}

/// A call as the core describes it, `OverlayCall.description` of the analyzed script
export interface OverlayCallDescription {
    namespace: string;
    function: string;
    effect: 'read' | 'write';
    explain: boolean;
    options: Record<string, unknown>;
    bindings?: OverlayCallBinding[];
}

/// A call that failed, the status is set if a service answered
export class OverlayError extends Error {
    constructor(message: string, public readonly status: number | null = null) {
        super(message);
        this.name = 'OverlayError';
    }
}

/// The function of a call
export function findOverlayFunction(spec: OverlaySpec, name: string): OverlayFunction {
    const fn = spec.functions.find(f => f.name === name);
    if (fn === undefined) {
        throw new OverlayError(`${spec.namespace} has no function ${name}`);
    }
    return fn;
}

/// The pending rule of a function
export function pendingOf(spec: OverlaySpec, fn: OverlayFunction): OverlayPending | null {
    return fn.pending === undefined ? (spec.pending ?? null) : fn.pending;
}

/// Does a call change anything? A raw call follows its method, an unknown method is a write.
export function isWriteCall(fn: OverlayFunction, options: Record<string, unknown>): boolean {
    const isGet = (method: unknown) => typeof method === 'string' && method.toUpperCase() === 'GET';
    if (fn.raw) {
        return !isGet(options['method']);
    }
    return fn.effect !== undefined ? fn.effect === 'write' : !isGet(fn.method);
}

/// Read a JSON pointer, undefined if the path doesn't exist
export function readJsonPointer(value: unknown, pointer: string): unknown {
    if (pointer === '') {
        return value;
    }
    let current = value;
    for (const raw of pointer.split('/').slice(1)) {
        const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (Array.isArray(current)) {
            current = current[Number(segment)];
        } else if (typeof current === 'object' && current !== null) {
            current = (current as Record<string, unknown>)[segment];
        } else {
            return undefined;
        }
    }
    return current;
}
