import { describe, expect, it } from 'vitest';

import { buildEntity, entityId, parseEmbedLink } from './entity.js';
import { handleRequest, hmacSha256Hex, type Dependencies, type Env } from './worker.js';

const APP = 'https://dev.dashql.app';
const NOW = 1_800_000_000;

const ENV: Env = {
    CHANNEL: 'dev',
    APP_ORIGIN: APP,
    SLACK_SIGNING_SECRET: 'signing-secret',
    SLACK_BOT_TOKEN: 'xoxb-test',
};

interface SlackCall {
    method: string;
    authorization: string | null;
    params: URLSearchParams;
}

function harness(slackResult: object = { ok: true }) {
    const calls: SlackCall[] = [];
    const pending: Promise<unknown>[] = [];
    const deps: Dependencies = {
        now: () => NOW,
        fetch: async (input, init) => {
            const url = String(input);
            calls.push({
                method: url.slice('https://slack.com/api/'.length),
                authorization: new Headers(init?.headers).get('authorization'),
                params: new URLSearchParams(String(init?.body)),
            });
            return new Response(JSON.stringify(slackResult), { headers: { 'content-type': 'application/json' } });
        },
    };
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
    return {
        calls,
        async send(request: Request) {
            const response = await handleRequest(request, ENV, ctx, deps);
            await Promise.all(pending);
            return response;
        },
    };
}

async function signedRequest(body: object, options: { timestamp?: number; secret?: string; headers?: Record<string, string> } = {}) {
    const text = JSON.stringify(body);
    const timestamp = String(options.timestamp ?? NOW);
    const signature = `v0=${await hmacSha256Hex(options.secret ?? ENV.SLACK_SIGNING_SECRET, `v0:${timestamp}:${text}`)}`;
    return new Request('https://slack.dashql.app/dev/events', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-slack-request-timestamp': timestamp,
            'x-slack-signature': signature,
            ...options.headers,
        },
        body: text,
    });
}

// The fields of a Work Object entity that the tests read
type TestEntity = {
    entity_type: string;
    app_unfurl_url: string;
    external_ref: unknown;
    entity_payload: { attributes: { title: { text: string }; full_size_preview: { preview_url?: string } } };
};

function linkShared(urls: string[]) {
    return {
        type: 'event_callback',
        api_app_id: 'A1',
        event: {
            type: 'link_shared',
            channel: 'C1',
            message_ts: '1700000000.000100',
            unfurl_id: 'U1',
            source: 'conversations_history',
            links: urls.map(url => ({ url, domain: new URL(url).hostname })),
        },
    };
}

describe('parseEmbedLink', () => {
    it('reads a data file link', () => {
        const link = parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fdata.example.com%2Fx%2Ftrips%202024.parquet&format=parquet`, APP);
        expect(link).toEqual({
            kind: 'data_file',
            url: `${APP}/embed?file=https%3A%2F%2Fdata.example.com%2Fx%2Ftrips%202024.parquet&format=parquet`,
            title: 'trips 2024.parquet',
            fileHost: 'data.example.com',
            fileFormat: 'parquet',
        });
    });

    it('reads the other modes', () => {
        expect(parseEmbedLink(`${APP}/embed#script=abc`, APP)?.kind).toBe('hyper_script');
        expect(parseEmbedLink(`${APP}/embed?zip=abc`, APP)?.kind).toBe('workbook');
        expect(parseEmbedLink(`${APP}/embed`, APP)?.kind).toBe('embed');
        expect(parseEmbedLink(`${APP}/embed.html`, APP)?.kind).toBe('embed');
    });

    it('rejects links that are not embeds of the app', () => {
        expect(parseEmbedLink('https://dashql.app/embed', APP)).toBeNull();
        expect(parseEmbedLink(`${APP}/`, APP)).toBeNull();
        expect(parseEmbedLink(`${APP}/embed/x`, APP)).toBeNull();
        expect(parseEmbedLink('http://dev.dashql.app/embed', APP)).toBeNull();
        expect(parseEmbedLink('https://user:pw@dev.dashql.app/embed', APP)).toBeNull();
        expect(parseEmbedLink('not a url', APP)).toBeNull();
    });

    it('rejects files that are not https and unknown formats', () => {
        expect(parseEmbedLink(`${APP}/embed?file=http%3A%2F%2Fexample.com%2Fa.csv`, APP)).toBeNull();
        expect(parseEmbedLink(`${APP}/embed?file=javascript%3Aalert(1)`, APP)).toBeNull();
        expect(parseEmbedLink(`${APP}/embed?file=nope`, APP)).toBeNull();
        expect(parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fexample.com%2Fa&format=exe`, APP)).toBeNull();
    });

    it('truncates long file names', () => {
        const name = 'a'.repeat(300);
        const link = parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fexample.com%2F${name}`, APP);
        expect(link?.title.length).toBe(120);
        expect(link?.title.endsWith('…')).toBe(true);
    });
});

describe('buildEntity', () => {
    it('gives the same id to the same link', async () => {
        const a = parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fexample.com%2Fa.csv`, APP)!;
        const b = parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fexample.com%2Fb.csv`, APP)!;
        expect(await entityId(a)).toBe(await entityId({ ...a }));
        expect(await entityId(a)).not.toBe(await entityId(b));
        expect(await entityId(a)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('sets the preview URL only for the side panel', async () => {
        const link = parseEmbedLink(`${APP}/embed?file=https%3A%2F%2Fexample.com%2Fa.csv`, APP)!;
        const unfurl = (await buildEntity(link, false)) as TestEntity;
        const details = (await buildEntity(link, true)) as TestEntity;
        expect(unfurl.entity_payload.attributes.full_size_preview).toEqual({
            is_supported: true,
            mime_type: 'application/vnd.slack-embed',
        });
        expect(details.entity_payload.attributes.full_size_preview.preview_url).toBe(link.url);
        expect(details.external_ref).toEqual(unfurl.external_ref);
        expect(details.entity_type).toBe('slack#/entities/file');
    });
});

describe('handleRequest', () => {
    it('answers health checks on its own path only', async () => {
        const h = harness();
        expect((await h.send(new Request('https://slack.dashql.app/dev/health'))).status).toBe(200);
        expect((await h.send(new Request('https://slack.dashql.app/stable/health'))).status).toBe(404);
        expect((await h.send(new Request('https://slack.dashql.app/dev/events'))).status).toBe(405);
    });

    it('rejects requests without a valid signature', async () => {
        const h = harness();
        expect((await h.send(await signedRequest(linkShared([`${APP}/embed`]), { secret: 'other' }))).status).toBe(401);
        expect((await h.send(await signedRequest(linkShared([`${APP}/embed`]), { timestamp: NOW - 301 }))).status).toBe(401);
        const unsigned = new Request('https://slack.dashql.app/dev/events', { method: 'POST', body: '{}' });
        expect((await h.send(unsigned)).status).toBe(401);
        expect(h.calls).toEqual([]);
    });

    it('answers the URL verification', async () => {
        const h = harness();
        const response = await h.send(await signedRequest({ type: 'url_verification', challenge: 'c-123', token: 't' }));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('c-123');
    });

    it('unfurls embed links as Work Objects', async () => {
        const h = harness();
        const file = `${APP}/embed?file=https%3A%2F%2Fexample.com%2Fa.csv`;
        const response = await h.send(await signedRequest(linkShared([file, file, 'https://dev.dashql.app/', `${APP}/embed#script=x`])));
        expect(response.status).toBe(200);
        expect(h.calls).toHaveLength(1);
        const call = h.calls[0];
        expect(call.method).toBe('chat.unfurl');
        expect(call.authorization).toBe('Bearer xoxb-test');
        expect(call.params.get('unfurl_id')).toBe('U1');
        expect(call.params.get('source')).toBe('conversations_history');
        expect(call.params.get('unfurls')).toBe('{}');
        const metadata: { entities: TestEntity[] } = JSON.parse(call.params.get('metadata')!);
        expect(metadata.entities.map(e => [e.entity_type, e.app_unfurl_url, e.entity_payload.attributes.title.text])).toEqual([
            ['slack#/entities/file', file, 'a.csv'],
            ['slack#/entities/item', `${APP}/embed#script=x`, 'Hyper script'],
        ]);
        expect(metadata.entities[0].entity_payload.attributes.full_size_preview.preview_url).toBeUndefined();
    });

    it('uses channel and ts without an unfurl id', async () => {
        const h = harness();
        const payload = linkShared([`${APP}/embed`]);
        const { unfurl_id: _unfurlId, source: _source, ...event } = payload.event;
        await h.send(await signedRequest({ ...payload, event }));
        expect(h.calls[0].params.get('channel')).toBe('C1');
        expect(h.calls[0].params.get('ts')).toBe('1700000000.000100');
    });

    it('ignores links of other apps and retries', async () => {
        const h = harness();
        await h.send(await signedRequest(linkShared(['https://dashql.app/embed'])));
        await h.send(await signedRequest(linkShared([`${APP}/embed`]), { headers: { 'x-slack-retry-num': '1' } }));
        expect(h.calls).toEqual([]);
    });

    it('presents the side panel with the preview URL', async () => {
        const h = harness();
        const file = `${APP}/embed?file=https%3A%2F%2Fexample.com%2Fa.csv`;
        await h.send(
            await signedRequest({
                type: 'event_callback',
                event: {
                    type: 'entity_details_requested',
                    trigger_id: '123.456.abc',
                    entity_url: file,
                    app_unfurl_url: file,
                    link: { url: file, domain: 'dev.dashql.app' },
                    external_ref: { id: 'x', type: 'data_file' },
                },
            }),
        );
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0].method).toBe('entity.presentDetails');
        expect(h.calls[0].params.get('trigger_id')).toBe('123.456.abc');
        const metadata = JSON.parse(h.calls[0].params.get('metadata')!);
        expect(metadata.entity_payload.attributes.full_size_preview.preview_url).toBe(file);
        const link = parseEmbedLink(file, APP)!;
        expect(metadata.external_ref).toEqual({ id: await entityId(link), type: 'data_file' });
    });

    it('answers 200 when Slack rejects the call', async () => {
        const h = harness({ ok: false, error: 'invalid_metadata' });
        const response = await h.send(await signedRequest(linkShared([`${APP}/embed`])));
        expect(response.status).toBe(200);
        expect(h.calls).toHaveLength(1);
    });
});
