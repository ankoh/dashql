import { OverlayAttribute, OverlayCallBinding, OverlayCallDescription, OverlayError, OverlayFunction, OverlaySchema, OverlaySpec } from './overlay_spec.js';

/// The options that the runtime applies itself, they are never sent
export const STANDARD_OPTIONS = ['_next', '_pages', '_poll', '_wait'] as const;

/// A request of a function, before a binding resolves its host
export interface OverlayRequest {
    /// The HTTP method
    method: string;
    /// The name of the host in the overlay
    host: string;
    /// The path below the host, with its base path and placeholders filled in. A followed URL has none.
    path: string;
    /// The query parameters, not encoded
    query: [string, string][];
    /// The headers of options, not those of the binding
    headers: [string, string][];
    /// The body
    body: string | null;
    /// The URL to follow instead of the path and query
    followUrl: string | null;
}

/// Set a JSON pointer in place
function writeJsonPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
    const segments = pointer.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: any = target;
    for (const segment of segments.slice(0, -1)) {
        current = current[segment];
    }
    current[segments[segments.length - 1]] = value;
}

/// Fill in the bindings of a call. What can't be resolved fails, unless `resolve` chooses otherwise.
export async function bindCallOptions(
    description: OverlayCallDescription,
    resolve: (binding: OverlayCallBinding) => unknown | Promise<unknown>,
): Promise<Record<string, unknown>> {
    const options = structuredClone(description.options);
    for (const binding of description.bindings ?? []) {
        writeJsonPointer(options, binding.pointer, await resolve(binding));
    }
    return options;
}

/// The attribute of a name
function findAttribute(attributes: OverlayAttribute[] | undefined, name: string): OverlayAttribute | undefined {
    return attributes?.find(a => a.name === name);
}

/// The attribute of a name in a schema. A name means the same in all variants of a union, so any of them can answer.
function findSchemaAttribute(spec: OverlaySpec, schema: OverlaySchema | undefined, name: string): OverlayAttribute | undefined {
    const own = findAttribute(schema?.attributes, name);
    if (own !== undefined) {
        return own;
    }
    for (const variant of schema?.variants ?? []) {
        const attribute = findAttribute(spec.schemas?.[variant]?.attributes, name);
        if (attribute !== undefined) {
            return attribute;
        }
    }
    return undefined;
}

/// A value in the spelling of the API
function toApiValue(spec: OverlaySpec, value: unknown, attribute: OverlayAttribute | undefined): unknown {
    if (Array.isArray(value)) {
        return value.map(item => toApiValue(spec, item, attribute));
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    const schema = attribute?.schema !== undefined ? spec.schemas?.[attribute.schema] : undefined;
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(value)) {
        const fieldAttribute = findSchemaAttribute(spec, schema, name);
        out[fieldAttribute?.api_name ?? name] = toApiValue(spec, field, fieldAttribute);
    }
    return out;
}

/// A scalar in a query string or a form
function scalarText(value: unknown): string {
    return typeof value === 'string' ? value : String(value);
}

/// Flatten a value to `a[b][0]=1` pairs, a null is left out
function flatten(name: string, value: unknown, out: [string, string][]): void {
    if (value === null || value === undefined) {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, i) => flatten(`${name}[${i}]`, item, out));
    } else if (typeof value === 'object') {
        for (const [key, field] of Object.entries(value)) {
            flatten(`${name}[${key}]`, field, out);
        }
    } else {
        out.push([name, scalarText(value)]);
    }
}

/// Add a query option in its style
function addQueryOption(name: string, value: unknown, style: OverlayAttribute['style'], out: [string, string][]): void {
    if (value === null || value === undefined) {
        return;
    }
    if (Array.isArray(value)) {
        if (style === 'deep') {
            flatten(name, value, out);
        } else if (style === 'csv') {
            out.push([name, value.map(scalarText).join(',')]);
        } else {
            value.forEach(item => out.push([name, scalarText(item)]));
        }
    } else if (typeof value === 'object') {
        flatten(name, value, out);
    } else {
        out.push([name, scalarText(value)]);
    }
}

/// Encode a value of a path. It can't reach another endpoint: a multi-segment value is encoded per segment, and it has no
/// `.` or `..` segment.
function encodePathValue(name: string, value: unknown, multiSegment: boolean): string {
    const text = scalarText(value);
    if (!multiSegment) {
        return encodeURIComponent(text);
    }
    const segments = text.split('/');
    if (segments.some(s => s === '.' || s === '..')) {
        throw new OverlayError(`the path option ${name} has a relative segment`);
    }
    return segments.map(encodeURIComponent).join('/');
}

/// Fill in `{name}` placeholders with text from a lookup
function fillPlaceholders(template: string, lookup: (name: string) => string | undefined, describe: (name: string) => string): string {
    return template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
        const value = lookup(name);
        if (value === undefined) {
            throw new OverlayError(describe(name));
        }
        return value;
    });
}

/// The base path of a host
function basePath(spec: OverlaySpec, host: string, variables: Record<string, string>): string {
    const declared = spec.hosts?.[host];
    if (declared === undefined) {
        throw new OverlayError(`${spec.namespace} has no host ${host}`);
    }
    return fillPlaceholders(declared.base_path ?? '', name => variables[name], name => `the host ${host} needs the variable ${name}`);
}

/// The request of the escape hatch. Its host is a name of the overlay and its path is relative, so the security rules hold.
function buildRawRequest(spec: OverlaySpec, fn: OverlayFunction, options: Record<string, unknown>, variables: Record<string, string>): OverlayRequest {
    const { method, path, host, body, ...rest } = options;
    if (typeof method !== 'string' || typeof path !== 'string') {
        throw new OverlayError(`${spec.namespace}.${fn.name} needs the options method and path`);
    }
    if (!path.startsWith('/') || path.startsWith('//') || path.split('/').some(s => s === '.' || s === '..')) {
        throw new OverlayError(`the path of ${spec.namespace}.${fn.name} must be relative to its host`);
    }
    const hostName = typeof host === 'string' ? host : fn.host;
    if (hostName === undefined) {
        throw new OverlayError(`${spec.namespace}.${fn.name} needs the option host`);
    }
    const query: [string, string][] = [];
    for (const [name, value] of Object.entries(rest)) {
        addQueryOption(name, value, undefined, query);
    }
    return {
        method: method.toUpperCase(),
        host: hostName,
        path: basePath(spec, hostName, variables) + path,
        query,
        headers: body === undefined ? [] : [['Content-Type', 'application/json']],
        body: body === undefined ? null : JSON.stringify(body),
        followUrl: null,
    };
}

/// Build the request of a call from options whose bindings are filled in. The standard options are ignored.
export function buildOverlayRequest(spec: OverlaySpec, fn: OverlayFunction, options: Record<string, unknown>, variables: Record<string, string>): OverlayRequest {
    if (fn.raw) {
        const rest = Object.fromEntries(Object.entries(options).filter(([name]) => !(STANDARD_OPTIONS as readonly string[]).includes(name)));
        return buildRawRequest(spec, fn, rest, variables);
    }
    if (fn.host === undefined || fn.path === undefined) {
        throw new OverlayError(`${spec.namespace}.${fn.name} has no host or path`);
    }
    const hasBody = fn.body !== undefined || (fn.options ?? []).some(o => o.in?.startsWith('body'));
    const pathValues = new Map<string, string>();
    const query: [string, string][] = [];
    const headers: [string, string][] = [];
    const bodyFields: Record<string, unknown> = {};
    let rootBody: unknown = undefined;

    for (const [name, value] of Object.entries(options)) {
        if ((STANDARD_OPTIONS as readonly string[]).includes(name)) {
            continue;
        }
        const attribute = findAttribute(fn.options, name);
        const apiName = attribute?.api_name ?? name;
        // A name the overlay doesn't list goes to the body if the function has one
        const location = attribute?.in ?? (hasBody ? 'body' : 'query');
        if (location === 'path') {
            pathValues.set(apiName, encodePathValue(name, value, attribute?.multi_segment ?? false));
        } else if (location === 'query') {
            addQueryOption(apiName, toApiValue(spec, value, attribute), attribute?.style, query);
        } else if (location === 'header') {
            headers.push([apiName, scalarText(value)]);
        } else if (location === 'body_root') {
            rootBody = toApiValue(spec, value, attribute);
        } else if (location === 'body') {
            bodyFields[apiName] = toApiValue(spec, value, attribute);
        } else {
            throw new OverlayError(`${spec.namespace}.${fn.name}: the option ${name} has the unknown location ${location}`);
        }
    }

    const path = fillPlaceholders(fn.path, name => pathValues.get(name), name => `${spec.namespace}.${fn.name} needs the path value ${name}`);
    let body: string | null = null;
    const format = fn.body ?? 'json';
    const hasFields = Object.keys(bodyFields).length > 0;
    if (rootBody !== undefined || hasFields) {
        if (format === 'json') {
            headers.push(['Content-Type', 'application/json']);
            body = JSON.stringify(rootBody !== undefined ? rootBody : bodyFields);
        } else if (format === 'form') {
            const pairs: [string, string][] = [];
            for (const [name, value] of Object.entries(bodyFields)) {
                flatten(name, value, pairs);
            }
            headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
            body = new URLSearchParams(pairs).toString();
        } else {
            // A media type: the body is one string option
            const values = Object.values(bodyFields);
            if (values.length !== 1 || typeof values[0] !== 'string') {
                throw new OverlayError(`${spec.namespace}.${fn.name} takes a ${format} body as one string`);
            }
            headers.push(['Content-Type', format]);
            body = values[0];
        }
    }
    return {
        method: (fn.method ?? 'GET').toUpperCase(),
        host: fn.host,
        path: basePath(spec, fn.host, variables) + path,
        query,
        headers,
        body,
        followUrl: null,
    };
}

/// A request that follows a URL from a response: always a GET without a body, so it can't repeat a create. The headers of
/// options still apply, the path and query come from the URL.
export function followRequest(request: OverlayRequest, url: string): OverlayRequest {
    const headers = request.headers.filter(([name]) => name.toLowerCase() !== 'content-type');
    return { ...request, method: 'GET', path: '', query: [], headers, body: null, followUrl: url };
}

/// Resolve a URL from a response or a script. A URL on another origin never receives the token.
export function resolveFollowUrl(baseUrl: URL, url: string): URL {
    const resolved = new URL(url, baseUrl);
    if (resolved.origin !== baseUrl.origin) {
        throw new OverlayError(`the URL ${resolved.origin} is on another origin than ${baseUrl.origin}`);
    }
    return resolved;
}

/// The URL of a request on a host
export function requestUrl(request: OverlayRequest, baseUrl: URL): URL {
    if (request.followUrl !== null) {
        return resolveFollowUrl(baseUrl, request.followUrl);
    }
    const url = new URL(baseUrl);
    url.pathname = baseUrl.pathname.replace(/\/$/, '') + request.path;
    for (const [name, value] of request.query) {
        url.searchParams.append(name, value);
    }
    return url;
}
