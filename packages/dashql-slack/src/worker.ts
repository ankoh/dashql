// The Slack app of DashQL as a Cloudflare Worker: it turns embed links into Work Objects, see docs/wip/embeds.md.
//
// One Worker per channel (dev, stable, latest), each on its own path of slack.dashql.app and with the secrets of its
// own Slack app. Slack posts the events to /<channel>/events. The Worker answers each event with 200 at once and makes
// the call to Slack in waitUntil: Slack ignores the body of the answer, an unfurl is a separate call with the bot token.

import { buildEntity, parseEmbedLink, type EmbedLink } from './entity.js';

export interface Env {
    // dev, stable or latest, the first segment of the paths of this Worker
    CHANNEL: string;
    // The origin of the app whose embed links this Worker unfurls, e.g. https://dev.dashql.app
    APP_ORIGIN: string;
    // Basic Information → App Credentials → Signing Secret
    SLACK_SIGNING_SECRET: string;
    // OAuth & Permissions → Bot User OAuth Token
    SLACK_BOT_TOKEN: string;
}

export interface Context {
    waitUntil(promise: Promise<unknown>): void;
}

export interface Dependencies {
    fetch: typeof fetch;
    // Seconds since the epoch
    now: () => number;
}

const SLACK_API = 'https://slack.com/api';
// Slack's limit for the age of a signed request
const MAX_REQUEST_AGE_SECONDS = 5 * 60;
// The body of an event is small, anything larger is not from Slack
const MAX_BODY_BYTES = 64 * 1024;

const defaultDependencies: Dependencies = {
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
};

export default {
    fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
        return handleRequest(request, env, ctx, defaultDependencies);
    },
};

export async function handleRequest(request: Request, env: Env, ctx: Context, deps: Dependencies): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === `/${env.CHANNEL}/health` && request.method === 'GET') {
        return new Response('ok\n', { headers: { 'content-type': 'text/plain' } });
    }
    if (path !== `/${env.CHANNEL}/events`) {
        return new Response('not found\n', { status: 404 });
    }
    if (request.method !== 'POST') {
        return new Response('method not allowed\n', { status: 405, headers: { allow: 'POST' } });
    }
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
        return new Response('too large\n', { status: 413 });
    }
    const verified = await verifySlackSignature(
        env.SLACK_SIGNING_SECRET,
        request.headers.get('x-slack-request-timestamp'),
        request.headers.get('x-slack-signature'),
        body,
        deps.now(),
    );
    if (!verified) {
        return new Response('invalid signature\n', { status: 401 });
    }
    let payload: SlackPayload;
    try {
        payload = JSON.parse(body) as SlackPayload;
    } catch {
        return new Response('invalid json\n', { status: 400 });
    }
    if (payload.type === 'url_verification') {
        return new Response(String(payload.challenge ?? ''), { headers: { 'content-type': 'text/plain' } });
    }
    // Slack retries an event that it thinks failed. Every event was answered at once, so a retry means that the call
    // to Slack may have been made already: don't unfurl twice.
    if (request.headers.has('x-slack-retry-num')) {
        return new Response(null, { status: 200 });
    }
    if (payload.type === 'event_callback' && payload.event !== undefined) {
        const work = handleEvent(payload.event, env, deps).catch(e => {
            console.error(`event ${payload.event?.type} failed: ${e instanceof Error ? e.message : String(e)}`);
        });
        ctx.waitUntil(work);
    }
    return new Response(null, { status: 200 });
}

interface SlackPayload {
    type?: string;
    challenge?: unknown;
    event?: SlackEvent;
}

interface SlackEvent {
    type?: string;
    // link_shared
    channel?: string;
    message_ts?: string;
    unfurl_id?: string;
    source?: string;
    links?: { url?: string; domain?: string }[];
    // entity_details_requested
    trigger_id?: string;
    entity_url?: string;
    app_unfurl_url?: string;
    link?: { url?: string; domain?: string };
}

async function handleEvent(event: SlackEvent, env: Env, deps: Dependencies): Promise<void> {
    switch (event.type) {
        case 'link_shared':
            await unfurlLinks(event, env, deps);
            break;
        case 'entity_details_requested':
            await presentDetails(event, env, deps);
            break;
        default:
            break;
    }
}

// link_shared → chat.unfurl with one entity per embed link, without the preview URL
async function unfurlLinks(event: SlackEvent, env: Env, deps: Dependencies): Promise<void> {
    // app_unfurl_url is the link as it was posted, the entity has the normalized one
    const links = new Map<string, { posted: string; link: EmbedLink }>();
    for (const shared of event.links ?? []) {
        const link = typeof shared.url === 'string' ? parseEmbedLink(shared.url, env.APP_ORIGIN) : null;
        if (link !== null && !links.has(link.url)) {
            links.set(link.url, { posted: shared.url as string, link });
        }
    }
    if (links.size === 0) {
        return;
    }
    const entities = await Promise.all(
        Array.from(links.values(), async ({ posted, link }) => ({
            app_unfurl_url: posted,
            ...(await buildEntity(link, false)),
        })),
    );
    const params: Record<string, string> = {
        unfurls: '{}',
        metadata: JSON.stringify({ entities }),
    };
    // unfurl_id and source identify links in the composer too, channel and ts only links of sent messages. Enterprise
    // organizations don't send them.
    if (event.unfurl_id !== undefined && event.source !== undefined) {
        params.unfurl_id = event.unfurl_id;
        params.source = event.source;
    } else if (event.channel !== undefined && event.message_ts !== undefined) {
        params.channel = event.channel;
        params.ts = event.message_ts;
    } else {
        return;
    }
    await callSlack('chat.unfurl', params, env, deps);
}

// entity_details_requested → entity.presentDetails with the preview URL, which Slack loads in the side panel
async function presentDetails(event: SlackEvent, env: Env, deps: Dependencies): Promise<void> {
    if (event.trigger_id === undefined) {
        return;
    }
    const candidates = [event.app_unfurl_url, event.link?.url, event.entity_url];
    let link: EmbedLink | null = null;
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            link = parseEmbedLink(candidate, env.APP_ORIGIN);
            if (link !== null) {
                break;
            }
        }
    }
    if (link === null) {
        return;
    }
    await callSlack(
        'entity.presentDetails',
        {
            trigger_id: event.trigger_id,
            metadata: JSON.stringify(await buildEntity(link, true)),
        },
        env,
        deps,
    );
}

async function callSlack(method: string, params: Record<string, string>, env: Env, deps: Dependencies): Promise<void> {
    const response = await deps.fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) {
        throw new Error(`${method}: HTTP ${response.status}`);
    }
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (result.ok !== true) {
        throw new Error(`${method}: ${result.error ?? 'unknown error'}`);
    }
}

// Slack signs `v0:<timestamp>:<body>` with HMAC-SHA256 and the signing secret of the app
export async function verifySlackSignature(
    secret: string,
    timestamp: string | null,
    signature: string | null,
    body: string,
    now: number,
): Promise<boolean> {
    if (secret === '' || timestamp === null || signature === null || !/^\d+$/.test(timestamp)) {
        return false;
    }
    if (Math.abs(now - Number(timestamp)) > MAX_REQUEST_AGE_SECONDS) {
        return false;
    }
    const expected = `v0=${await hmacSha256Hex(secret, `v0:${timestamp}:${body}`)}`;
    return timingSafeEqual(expected, signature);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; ++i) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
