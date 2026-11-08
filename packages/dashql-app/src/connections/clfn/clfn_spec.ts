/// The spec of client functions, see docs/design/client_functions.md. The core reads the signatures of the same document.

/// An option of a function or an attribute of a schema
export interface ClientFunctionAttribute {
    /// The name in a script
    name: string;
    /// The spelling of the API, the name if absent
    api_name?: string;
    /// Options only: `path`, `query`, `header`, `body` or `body_root`. A path option fills the placeholder of its `api_name`.
    in?: string;
    /// The type of a scalar
    type?: string;
    /// The schema of an object
    schema?: string;
    /// Is the value a map? Its keys are free, the schema holds for its values.
    map?: boolean;
    /// Is the option required?
    required?: boolean;
    /// Query options with arrays or objects, `repeat` by default
    style?: 'repeat' | 'csv' | 'deep';
    /// Path options whose value may contain `/`
    multi_segment?: boolean;
}

/// A named object, or a union of named objects
export interface ClientFunctionSchema {
    attributes?: ClientFunctionAttribute[];
    /// A union: the schemas that a value can be. A name means the same in all of them.
    variants?: string[];
}

/// A result column
export interface ClientFunctionColumn {
    /// The name in a script
    name: string;
    /// The spelling of the API, the name if absent
    api_name?: string;
    /// VARCHAR, TIMESTAMPTZ, DATE, INTEGER, BIGINT, DOUBLE, BOOLEAN or JSON
    type?: string;
}

/// When a list of pages ends
export type ClientFunctionPagingEnd = 'empty_page' | 'short_page' | { total: string } | { has_more: string };

/// Where a value of a response is
export type ClientFunctionValueSource =
    /// A JSON pointer into the body
    | { body: string }
    /// A response header
    | { header: string }
    /// The entry with this `rel` of a `Link` header
    | { link: string }
    /// A JSON pointer into the last row of the page
    | { last_row: string };

/// How a function pages
export interface ClientFunctionPaging {
    kind: 'url' | 'token' | 'offset' | 'page';
    /// Where the value is
    from?: ClientFunctionValueSource;
    /// The option that takes the value
    option?: string;
    /// The option with the page size
    size?: string;
    /// The first offset or page
    start?: number;
    /// When the list ends
    end?: ClientFunctionPagingEnd;
}

/// How a function answers before it finishes
export interface ClientFunctionPending {
    /// The status that means not finished
    status: number;
    /// The header with the URL to poll, or a repeat of the request
    poll: { header: string } | { repeat: true };
}

/// How a function reports errors
export interface ClientFunctionErrors {
    /// JSON pointers to try for the error message
    message?: string[];
    /// A pointer that fails the statement when it's present, for a 200 that carries errors
    error_if?: string;
    /// The statuses that mean an empty result
    empty_on?: number[];
    /// Is the message a JSON string?
    message_is_json?: boolean;
}

/// A client function
export interface ClientFunction {
    name: string;
    method?: string;
    host?: string;
    path?: string;
    options?: ClientFunctionAttribute[];
    /// The format of the body: `json` by default, `form`, or a media type
    body?: string;
    rows?: string;
    columns?: ClientFunctionColumn[];
    paging?: ClientFunctionPaging;
    /// Overrides the default of the spec, null for none
    pending?: ClientFunctionPending | null;
    errors?: ClientFunctionErrors;
    effect?: 'read' | 'write';
    /// The escape hatch: takes `method`, `path`, `host` and `body`
    raw?: boolean;
}

/// A host that functions name, the binding of the connection resolves it
export interface ClientFunctionHost {
    base_path?: string;
}

/// The spec of client functions
export interface ClientFunctionSpec {
    format: number;
    namespace: string;
    hosts?: Record<string, ClientFunctionHost>;
    errors?: ClientFunctionErrors;
    pending?: ClientFunctionPending | null;
    schemas?: Record<string, ClientFunctionSchema>;
    functions: ClientFunction[];
}

/// A value that the runtime fills in
export interface ClientFunctionCallBinding {
    /// A JSON pointer into the options
    pointer: string;
    /// The name of the parameter
    param: string;
}

/// A call as the core describes it, `ClientFunctionCall.description` of the analyzed script
export interface ClientFunctionCallDescription {
    namespace: string;
    function: string;
    effect: 'read' | 'write';
    explain: boolean;
    options: Record<string, unknown>;
    bindings?: ClientFunctionCallBinding[];
}

/// A call that failed, the status is set if a service answered
export class ClientFunctionError extends Error {
    constructor(message: string, public readonly status: number | null = null) {
        super(message);
        this.name = 'ClientFunctionError';
    }
}

/// The function of a call
export function findClientFunction(spec: ClientFunctionSpec, name: string): ClientFunction {
    const fn = spec.functions.find(f => f.name === name);
    if (fn === undefined) {
        throw new ClientFunctionError(`${spec.namespace} has no function ${name}`);
    }
    return fn;
}

/// The pending rule of a function
export function pendingOf(spec: ClientFunctionSpec, fn: ClientFunction): ClientFunctionPending | null {
    return fn.pending === undefined ? (spec.pending ?? null) : fn.pending;
}

/// The segments of a JSON pointer
export function jsonPointerSegments(pointer: string): string[] {
    return pointer.split('/').slice(1).map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/// Read a JSON pointer, undefined if the path doesn't exist
export function readJsonPointer(value: unknown, pointer: string): unknown {
    if (pointer === '') {
        return value;
    }
    let current = value;
    for (const segment of jsonPointerSegments(pointer)) {
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
