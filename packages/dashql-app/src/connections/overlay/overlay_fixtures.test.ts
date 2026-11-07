import { describe, expect, it } from 'vitest';

import { explainOverlayCall, OverlayEnvironment, runOverlayCall } from './overlay_runtime.js';
import type { OverlayCallDescription, OverlaySpec } from './overlay_spec.js';

/// The real spec and its fixtures, see overlay/d360/tests. Their requests are computed apart from this runtime.
const SPEC = import.meta.glob<OverlaySpec>('@dashql/overlays/d360/api/spec.json', { import: 'default', eager: true });
const FIXTURES = import.meta.glob<{ cases: FixtureCase[] }>('@dashql/overlays/d360/tests/*.json', { import: 'default', eager: true });

interface FixtureCase {
    function: string;
    call: string;
    description: OverlayCallDescription;
    request: { method: string; host: string; path: string; query: [string, string][]; headers: Record<string, string>; body: unknown };
    response?: { source: string; status: number; headers: Record<string, string>; body: unknown };
    result?: { rows: Record<string, unknown>[] };
}

const spec = Object.values(SPEC)[0];
const API_VERSION = '68.0';

/// The parameters and secrets of a call print like in EXPLAIN
function bindingValues(description: OverlayCallDescription): Record<string, unknown> {
    return Object.fromEntries((description.bindings ?? []).filter(b => b.param !== undefined).map(b => [b.param!, `:${b.param}`]));
}

describe('The Data 360 overlay', () => {
    const files = Object.entries(FIXTURES).sort(([l], [r]) => l.localeCompare(r));

    it('has fixtures', () => {
        expect(spec.namespace).toEqual('cdp');
        expect(files.flatMap(([, f]) => f.cases).length).toBeGreaterThan(500);
    });

    for (const [path, fixture] of files) {
        const family = path.split('/').pop()!.replace('.json', '');
        describe(family, () => {
            it('builds the expected requests', async () => {
                for (const fixtureCase of fixture.cases) {
                    const result = await explainOverlayCall(spec, fixtureCase.description, {
                        variables: () => ({ api_version: API_VERSION }),
                    });
                    const field = (name: string) => result.rows[0][result.schema.fields.findIndex(f => f.name === name)] as string | null;
                    const expected = fixtureCase.request;
                    const context = fixtureCase.call;
                    expect(field('method'), context).toEqual(expected.method);
                    expect(field('host'), context).toEqual(expected.host);
                    expect(field('path'), context).toEqual(expected.path);
                    const query = expected.query.map(([name, value]) => `${name}=${value}`).join('&');
                    expect(field('query') ?? '', context).toEqual(query);
                    expect(JSON.parse(field('headers') ?? '{}'), context).toEqual(expected.headers);
                    const body = field('body');
                    if (expected.body === null) {
                        expect(body, context).toBeNull();
                    } else if (typeof expected.body === 'string') {
                        expect(body, context).toEqual(expected.body);
                    } else {
                        expect(JSON.parse(body!), context).toEqual(expected.body);
                    }
                }
            });

            it('reads the expected results', async () => {
                for (const fixtureCase of fixture.cases) {
                    if (fixtureCase.response === undefined) {
                        continue;
                    }
                    const { status, headers, body } = fixtureCase.response;
                    const env: OverlayEnvironment = {
                        http: { fetch: async () => new Response(JSON.stringify(body), { status, headers }) },
                        resolveHost: async () => ({ baseUrl: new URL('https://org.example.com'), headers: {} }),
                        variables: () => ({ api_version: API_VERSION }),
                        params: bindingValues(fixtureCase.description),
                        resolveSecret: async name => `secret(${name})`,
                    };
                    const result = await runOverlayCall(spec, fixtureCase.description, env);
                    const names = result.schema.fields.map(f => f.name);
                    const rows = result.rows.map(row => Object.fromEntries(names
                        .filter(name => name !== '_poll')
                        .map(name => {
                            const value = row[names.indexOf(name)];
                            const parsed = (name === '_meta' || name === '_raw') && typeof value === 'string' ? JSON.parse(value) : value;
                            return [name, parsed];
                        })));
                    expect(rows, fixtureCase.call).toEqual(fixtureCase.result!.rows);
                }
            });
        });
    }
});
