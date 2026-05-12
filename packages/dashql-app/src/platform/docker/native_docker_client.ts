import { Logger } from "../logger/logger.js";
import { RawProxyError } from "../channel_common.js";
import {
    HEADER_NAME_BATCH_BYTES,
    HEADER_NAME_BATCH_EVENT,
    HEADER_NAME_BATCH_TIMEOUT,
    HEADER_NAME_READ_TIMEOUT,
    HEADER_NAME_STREAM_ID,
} from "../native_proxy_headers.js";
import { DockerClient } from "./docker_client.js";
import {
    DockerContainerSummary,
    DockerCreateContainerSpec,
    DockerImageTagPage,
    DockerLogChunk,
    DockerPullProgress,
} from "./docker_types.js";

const LOG_CTX = "docker";

export interface NativeDockerProxyConfig {
    proxyEndpoint: URL;
}

class NativeDockerError extends Error {
    data: Record<string, string>;
    constructor(o: RawProxyError) {
        super(o.message);
        this.data = o.data ?? {};
    }
}

async function throwIfError(response: Response): Promise<void> {
    if (response.headers.get("dashql-error")) {
        const proxyError = (await response.json()) as RawProxyError;
        throw new NativeDockerError(proxyError);
    } else if (response.status < 200 || response.status >= 300) {
        let body: string | undefined;
        try {
            body = await response.text();
        } catch (_) {}
        throw new NativeDockerError({ message: body ?? response.statusText });
    }
}

/// Parse Docker's multiplexed log frame format. Each frame:
/// [stream_type:u8][0:u8][0:u8][0:u8][length:u32 BE][payload:length bytes]
/// Returns parsed chunks and any leftover bytes that couldn't form a full frame.
function parseDockerFrames(buffer: Uint8Array): { chunks: DockerLogChunk[]; rest: Uint8Array<ArrayBufferLike> } {
    const chunks: DockerLogChunk[] = [];
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let offset = 0;
    while (offset + 8 <= buffer.length) {
        const streamType = buffer[offset];
        // Sanity check: valid frame headers have stream_type in {0,1,2} and bytes 1..3 == 0.
        // If not, fall through to "raw" mode for the remainder.
        if (streamType > 2 || buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
            // Treat the remaining buffer as a raw text chunk (TTY mode).
            const text = decoder.decode(buffer.subarray(offset));
            chunks.push({ stream: -1, text });
            return { chunks, rest: new Uint8Array(0) };
        }
        const length =
            (buffer[offset + 4] << 24) |
            (buffer[offset + 5] << 16) |
            (buffer[offset + 6] << 8) |
            buffer[offset + 7];
        const frameEnd = offset + 8 + length;
        if (frameEnd > buffer.length) {
            break; // wait for more bytes
        }
        const payload = buffer.subarray(offset + 8, frameEnd);
        chunks.push({ stream: streamType, text: decoder.decode(payload) });
        offset = frameEnd;
    }
    return { chunks, rest: buffer.subarray(offset) };
}

export class NativeDockerClient implements DockerClient {
    private readonly logger: Logger;
    private readonly endpoint: NativeDockerProxyConfig;

    constructor(config: NativeDockerProxyConfig, logger: Logger) {
        this.endpoint = config;
        this.logger = logger;
    }

    private url(path: string): URL {
        const url = new URL(this.endpoint.proxyEndpoint);
        url.pathname = path;
        return url;
    }

    async listContainers(labelKey?: string): Promise<DockerContainerSummary[]> {
        const url = this.url("/docker/containers");
        if (labelKey) {
            url.searchParams.set("label", labelKey);
        }
        const response = await fetch(url, { method: "GET" });
        await throwIfError(response);
        return (await response.json()) as DockerContainerSummary[];
    }

    async startContainer(id: string): Promise<void> {
        const response = await fetch(this.url(`/docker/containers/${encodeURIComponent(id)}/start`), {
            method: "POST",
        });
        await throwIfError(response);
    }

    async stopContainer(id: string): Promise<void> {
        const response = await fetch(this.url(`/docker/containers/${encodeURIComponent(id)}/stop`), {
            method: "POST",
        });
        await throwIfError(response);
    }

    async removeContainer(id: string, force: boolean): Promise<void> {
        const url = this.url(`/docker/containers/${encodeURIComponent(id)}`);
        url.searchParams.set("force", force ? "true" : "false");
        const response = await fetch(url, { method: "DELETE" });
        await throwIfError(response);
    }

    async createContainer(spec: DockerCreateContainerSpec, name?: string): Promise<string> {
        const url = this.url("/docker/containers");
        if (name) {
            url.searchParams.set("name", name);
        }
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(spec),
        });
        await throwIfError(response);
        const body = (await response.json()) as { Id: string };
        return body.Id;
    }

    /// Open a stream against /docker/log-streams or /docker/images/pull and return its id.
    private async openByteStream(method: "POST", path: string, search: Record<string, string>): Promise<number> {
        const url = this.url(path);
        for (const [k, v] of Object.entries(search)) {
            url.searchParams.set(k, v);
        }
        const response = await fetch(url, { method });
        await throwIfError(response);
        const id = response.headers.get(HEADER_NAME_STREAM_ID);
        if (id == null) {
            throw new Error("missing stream id from docker stream open");
        }
        return Number.parseInt(id, 10);
    }

    private async closeStream(streamId: number): Promise<void> {
        const url = this.url(`/docker/log-streams/${streamId}`);
        try {
            await fetch(url, { method: "DELETE" });
        } catch (e) {
            this.logger.debug("failed closing docker stream", { error: String(e) }, LOG_CTX);
        }
    }

    private async *pollByteStream(streamId: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
        try {
            while (true) {
                if (signal?.aborted) {
                    return;
                }
                const url = this.url(`/docker/log-streams/${streamId}`);
                const headers = new Headers();
                headers.set(HEADER_NAME_BATCH_BYTES, "1000000");
                headers.set(HEADER_NAME_BATCH_TIMEOUT, "1000");
                headers.set(HEADER_NAME_READ_TIMEOUT, "10000");
                const response = await fetch(url, { method: "GET", headers, signal });
                await throwIfError(response);
                const event = response.headers.get(HEADER_NAME_BATCH_EVENT);
                const buffer = new Uint8Array(await response.arrayBuffer());
                if (buffer.length > 0) {
                    yield buffer;
                }
                if (event === "ReadIdle") {
                    this.logger.trace("docker stream idle", { stream: String(streamId) }, LOG_CTX);
                    continue;
                }
                if (event === "StreamFinished" || event === "FlushAfterClose" || event === "StreamFailed") {
                    return;
                }
            }
        } finally {
            await this.closeStream(streamId);
        }
    }

    async *streamLogs(containerId: string, signal?: AbortSignal): AsyncIterable<DockerLogChunk> {
        const streamId = await this.openByteStream("POST", "/docker/log-streams", { container: containerId });
        let leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
        for await (const chunk of this.pollByteStream(streamId, signal)) {
            const merged = new Uint8Array(leftover.length + chunk.length);
            merged.set(leftover, 0);
            merged.set(chunk, leftover.length);
            const { chunks, rest } = parseDockerFrames(merged);
            leftover = rest;
            for (const c of chunks) {
                yield c;
            }
        }
    }

    async *pullImage(repository: string, tag: string, signal?: AbortSignal): AsyncIterable<DockerPullProgress> {
        const streamId = await this.openByteStream("POST", "/docker/images/pull", {
            fromImage: repository,
            tag,
        });
        const decoder = new TextDecoder();
        let leftover = "";
        for await (const chunk of this.pollByteStream(streamId, signal)) {
            const text = leftover + decoder.decode(chunk);
            const lines = text.split("\n");
            leftover = lines.pop() ?? "";
            for (const line of lines) {
                if (line.length === 0) continue;
                try {
                    yield JSON.parse(line) as DockerPullProgress;
                } catch (e) {
                    this.logger.debug("non-JSON pull line", { line }, LOG_CTX);
                }
            }
        }
        if (leftover.trim().length > 0) {
            try {
                yield JSON.parse(leftover) as DockerPullProgress;
            } catch (_) {}
        }
    }

    async *listImageTags(repository: string, signal?: AbortSignal): AsyncIterable<DockerImageTagPage> {
        const url = this.url("/docker/registry/tags");
        url.searchParams.set("repository", repository);
        const response = await fetch(url, { method: "GET", signal });
        await throwIfError(response);
        const body = (await response.json()) as { tags: string[] };
        const PAGE = 200;
        const tags = body.tags ?? [];
        for (let i = 0; i < tags.length; i += PAGE) {
            const slice = tags.slice(i, i + PAGE);
            yield { tags: slice, done: i + PAGE >= tags.length };
        }
        if (tags.length === 0) {
            yield { tags: [], done: true };
        }
    }
}
