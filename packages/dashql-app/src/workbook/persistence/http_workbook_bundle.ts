import type * as core from '@ankoh/dashql-core';

import type { HttpClient, HttpFetchResult } from '@ankoh/dashql-platform/platform/http/http_client';
import {
    STORAGE_WORKBOOK_FILE,
    STORAGE_ATTACHMENTS_FOLDER,
    STORAGE_SCRIPTS_FOLDER,
} from '@ankoh/dashql-platform/storage/storage_backend';
import { LEGACY_WORKBOOK_FILES } from '../../platform/events/legacy_links.js';

// A workbook that a web server hosts as the files of a workbook folder: the runtime reads it like any workbook folder
// (`RuntimeImportFolder`), the files are fetched when it asks for them. Workbooks published by older versions are
// migrated in memory.

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface HttpWorkbookLoadResult {
    /// The workbook that the runtime read, an import that waits for the user
    preview: core.ImportPreview;
    /// The number of scripts that the workbook file lists
    listedScriptCount: number;
    /// The number of scripts that were loaded
    loadedScriptCount: number;
    /// Were files missing, unusable or over the size budget?
    incomplete: boolean;
}

export type HttpWorkbookLoadProgress =
    | { phase: 'preparing' }
    | { phase: 'manifest' }
    | { phase: 'listing'; workbookName: string; workbookId: string }
    | {
        phase: 'files';
        workbookName: string;
        workbookId: string;
        completedFileCount: number;
        totalFileCount: number;
        completedScriptCount: number;
        totalScriptCount: number;
    };

/// Read a hosted workbook into an import of the runtime. `read` is the read of an import, e.g. `readImport` of the
/// import provider. The workbook file is required, the other files are fetched best effort: a file that is missing,
/// unusable or beyond the size budget is left out and the load is incomplete.
export async function readWorkbookFromHttp(
    manifestUrl: URL,
    httpClient: HttpClient,
    read: (source: { folder: core.RuntimeImportFolder }) => Promise<core.ImportPreview>,
    signal?: AbortSignal,
    onProgress?: (progress: HttpWorkbookLoadProgress) => void,
): Promise<HttpWorkbookLoadResult> {
    const manifestName = validateManifestUrl(manifestUrl);
    onProgress?.({ phase: 'manifest' });
    const manifestText = await fetchRequiredText(httpClient, manifestUrl, manifestName, MAX_MANIFEST_BYTES, signal);
    const head = manifestHead(manifestText);
    onProgress?.({ phase: 'listing', ...head });
    const folder = new HttpFolder(manifestUrl, httpClient, signal, manifestName, manifestText, progress => onProgress?.({ phase: 'files', ...head, ...progress }));
    const preview = await read({ folder });
    const loadedScriptCount = preview.scriptCount;
    return {
        preview,
        listedScriptCount: folder.listedScripts,
        loadedScriptCount,
        incomplete: !preview.filesValid || folder.overBudget || loadedScriptCount < folder.listedScripts
            || preview.attachmentCount < folder.listedAttachments,
    };
}

/// The name and the id of a workbook file for the progress, of any format version
function manifestHead(text: string): { workbookName: string; workbookId: string } {
    try {
        const manifest = JSON.parse(text) as Record<string, unknown>;
        const string = (value: unknown) => typeof value === 'string' ? value : null;
        const metadata = (manifest.metadata ?? {}) as Record<string, unknown>;
        return {
            workbookName: string(manifest.name)?.trim() || string(metadata.originalFileName) || 'Unnamed workbook',
            workbookId: string(manifest.workbookId) ?? string(manifest.sessionId) ?? string(manifest.notebookId) ?? '',
        };
    } catch {
        return { workbookName: 'Unnamed workbook', workbookId: '' };
    }
}

/// The counts of the files of a hosted workbook
type FileProgress = Pick<Extract<HttpWorkbookLoadProgress, { phase: 'files' }>, 'completedFileCount' | 'totalFileCount' | 'completedScriptCount' | 'totalScriptCount'>;

/// The files of a hosted workbook, fetched when the runtime asks for them.
///
/// Each top-level file is fetched at most once, a missing or unreadable file reads as null. The workbook file, the
/// listed scripts and the listed attachments are the files of the progress.
class HttpFolder implements core.RuntimeImportFolder {
    readonly errorPrefix = 'Invalid remote workbook';
    readonly metadata: { originType: 'HTTP'; originalHttpUrl: string };
    /// The scripts and attachments that the workbook file lists, once the runtime asked for them
    listedScripts = 0;
    listedAttachments = 0;
    /// Was a file left out because the workbook exceeds the size budget?
    overBudget = false;
    /// The URL of the workbook folder
    private readonly baseUrl: URL;
    /// The client that fetches the files
    private readonly httpClient: HttpClient;
    /// The signal that aborts the fetches
    private readonly signal: AbortSignal | undefined;
    /// The fetched top-level and catalog files by path, null for missing ones
    private readonly files: Map<string, Promise<string | null>>;
    /// The bytes fetched so far, the workbook file included
    private totalBytes: number;
    /// The progress of the files
    private readonly progress: FileProgress = { completedFileCount: 1, totalFileCount: 1, completedScriptCount: 0, totalScriptCount: 0 };
    private readonly onProgress: (progress: FileProgress) => void;

    constructor(manifestUrl: URL, httpClient: HttpClient, signal: AbortSignal | undefined, manifestName: string, manifestText: string, onProgress: (progress: FileProgress) => void) {
        this.baseUrl = new URL('.', manifestUrl);
        this.httpClient = httpClient;
        this.signal = signal;
        this.files = new Map([[manifestName, Promise.resolve(manifestText)]]);
        this.totalBytes = textBytes(manifestText);
        this.onProgress = onProgress;
        this.metadata = { originType: 'HTTP', originalHttpUrl: manifestUrl.toString() };
    }

    /// Count the bytes of an optional file, null once the workbook exceeds the size budget
    private budget<T>(content: T | null, bytes: number): T | null {
        if (content == null) return null;
        if (this.totalBytes + bytes > MAX_TOTAL_BYTES) {
            this.overBudget = true;
            return null;
        }
        this.totalBytes += bytes;
        return content;
    }

    readText(path: string): Promise<string | null> {
        let file = this.files.get(path);
        if (file === undefined) {
            file = fetchBestEffortText(this.httpClient, new URL(path, this.baseUrl), MAX_SCRIPT_BYTES, this.signal)
                .then(text => this.budget(text, text == null ? 0 : textBytes(text)));
            this.files.set(path, file);
        }
        return file;
    }

    async scripts(listed: string[]): Promise<{ name: string; sql: string }[]> {
        this.listedScripts = listed.length;
        this.progress.totalFileCount += listed.length;
        this.progress.totalScriptCount = listed.length;
        this.onProgress({ ...this.progress });
        const scripts = await Promise.all(listed.map(async name => {
            const sql = await fetchBestEffortText(this.httpClient, scriptUrl(this.baseUrl, name), MAX_SCRIPT_BYTES, this.signal);
            this.progress.completedFileCount += 1;
            this.progress.completedScriptCount += 1;
            this.onProgress({ ...this.progress });
            return { name, sql };
        }));
        // The scripts count against the budget in the order of the feed
        return scripts.flatMap(({ name, sql }) => {
            const kept = this.budget(sql, sql == null ? 0 : textBytes(sql));
            return kept == null ? [] : [{ name, sql: kept }];
        });
    }

    async attachments(listed: string[]): Promise<{ name: string; file: Uint8Array }[]> {
        this.listedAttachments = listed.length;
        this.progress.totalFileCount += listed.length;
        this.onProgress({ ...this.progress });
        const files = await Promise.all(listed.map(async name => {
            const bytes = await fetchBestEffortBytes(this.httpClient,
                new URL(`${STORAGE_ATTACHMENTS_FOLDER}/${encodeURIComponent(name)}`, this.baseUrl), MAX_TOTAL_BYTES, this.signal);
            this.progress.completedFileCount += 1;
            this.onProgress({ ...this.progress });
            return { name, bytes };
        }));
        return files.flatMap(({ name, bytes }) => {
            const kept = this.budget(bytes, bytes?.byteLength ?? 0);
            return kept == null ? [] : [{ name, file: kept }];
        });
    }
}

/// Validate the URL of a hosted workbook, returns the name of the workbook metadata
function validateManifestUrl(url: URL): string {
    const isPublicHttps = url.protocol === 'https:';
    const isDevelopmentLoopback = process.env.DASHQL_BUILD_MODE === 'development'
        && url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    if ((!isPublicHttps && !isDevelopmentLoopback) || url.username || url.password || url.hash) {
        throw new Error('Workbook URL must be public HTTPS or development loopback HTTP without credentials or a fragment');
    }
    // Links of older versions point to the metadata under its older name
    const name = url.pathname.split('/').pop();
    if (name == null || (name !== STORAGE_WORKBOOK_FILE && !LEGACY_WORKBOOK_FILES.includes(name))) {
        throw new Error(`Remote workbook URL must end in ${STORAGE_WORKBOOK_FILE}`);
    }
    return name;
}

async function fetchBestEffortBytes(
    httpClient: HttpClient, url: URL, maxBytes: number, signal?: AbortSignal,
): Promise<Uint8Array | null> {
    try {
        const response = await httpClient.fetch(url, { method: 'GET', credentials: 'omit', signal });
        if (response.status < 200 || response.status >= 300) return null;
        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.byteLength > maxBytes ? null : bytes;
    } catch (error) {
        if (signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
        return null;
    }
}

function scriptUrl(baseUrl: URL, scriptName: string): URL {
    return new URL(
        `${STORAGE_SCRIPTS_FOLDER}/${encodeURIComponent(scriptName)}`,
        baseUrl,
    );
}

async function fetchRequiredText(
    httpClient: HttpClient,
    url: URL,
    label: string,
    maxBytes: number,
    signal?: AbortSignal,
): Promise<string> {
    const response = await httpClient.fetch(url, { method: 'GET', credentials: 'omit', signal });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Failed to fetch remote workbook file ${label}: HTTP ${response.status}`);
    }
    return await readLimitedText(response, label, maxBytes);
}

async function fetchBestEffortText(
    httpClient: HttpClient,
    url: URL,
    maxBytes: number,
    signal?: AbortSignal,
): Promise<string | null> {
    try {
        const response = await httpClient.fetch(url, { method: 'GET', credentials: 'omit', signal });
        if (response.status < 200 || response.status >= 300) return null;
        return await readLimitedText(response, url.pathname, maxBytes);
    } catch (error) {
        if (signal?.aborted || (error as Error)?.name === 'AbortError') throw error;
        return null;
    }
}

async function readLimitedText(response: HttpFetchResult, label: string, maxBytes: number): Promise<string> {
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        throw new Error(`Remote workbook file ${label} exceeds the maximum size`);
    }
    const text = await response.text();
    if (textBytes(text) > maxBytes) {
        throw new Error(`Remote workbook file ${label} exceeds the maximum size`);
    }
    return text;
}

function textBytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}
