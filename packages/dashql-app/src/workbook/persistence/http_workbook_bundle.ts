import type { HttpClient, HttpFetchResult } from '@ankoh/dashql-runtime/platform/http/http_client';
import type { DataFileData, ScriptData } from '@ankoh/dashql-runtime/storage/storage_backend';
import {
    STORAGE_WORKBOOK_FILE,
    STORAGE_ATTACHMENTS_FOLDER,
    STORAGE_SCRIPTS_FOLDER,
} from '@ankoh/dashql-runtime/storage/storage_backend';
import type { WorkbookBundle } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import { assembleWorkbookBundle, readWorkbookBundleHead } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import type { MigrationFolder } from '@ankoh/dashql-runtime/storage/migration/migration_folder';
import { LEGACY_WORKBOOK_FILES } from '../../platform/events/legacy_links.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface HttpWorkbookLoadResult {
    /// The loaded workbook
    bundle: WorkbookBundle;
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

export async function readWorkbookBundleFromHttp(
    manifestUrl: URL,
    httpClient: HttpClient,
    signal?: AbortSignal,
    onProgress?: (progress: HttpWorkbookLoadProgress) => void,
): Promise<HttpWorkbookLoadResult> {
    const manifestName = validateManifestUrl(manifestUrl);
    const baseUrl = new URL('.', manifestUrl);
    let totalBytes = 0;

    onProgress?.({ phase: 'manifest' });
    const manifestText = await fetchRequiredText(httpClient, manifestUrl, manifestName, MAX_MANIFEST_BYTES, signal);
    totalBytes += textBytes(manifestText);
    // Workbooks published by older versions are migrated in memory
    const folder = new HttpFolder(baseUrl, httpClient, MAX_SCRIPT_BYTES, signal, manifestName, manifestText);
    const head = await readWorkbookBundleHead(folder, 'Invalid remote workbook');
    const workbook = head.workbook;
    const workbookName = workbook.name?.trim() || workbook.metadata.originalFileName || 'Unnamed workbook';
    totalBytes += head.catalogs.flatMap(catalog => [catalog.relations, catalog.functions])
        .reduce((bytes, text) => bytes + (text == null ? 0 : textBytes(text)), 0);

    onProgress?.({ phase: 'listing', workbookName, workbookId: workbook.workbookId });
    const listedScripts = workbook.scripts;
    const listedAttachments = workbook.attachments;
    const listedScriptCount = listedScripts.length;
    // The manifest and the catalog files of the connections
    const headFileCount = 1 + 2 * workbook.connections.length;
    const totalFileCount = headFileCount + listedScriptCount + listedAttachments.length;
    let completedFileCount = headFileCount;
    let completedScriptCount = 0;
    const reportFileProgress = () => onProgress?.({
        phase: 'files',
        workbookName,
        workbookId: workbook.workbookId,
        completedFileCount,
        totalFileCount,
        completedScriptCount,
        totalScriptCount: listedScriptCount,
    });
    const trackFile = async <T>(load: Promise<T>, script: boolean = false): Promise<T> => {
        try {
            return await load;
        } finally {
            completedFileCount += 1;
            if (script) completedScriptCount += 1;
            reportFileProgress();
        }
    };
    reportFileProgress();

    const scripts: ScriptData[] = (await Promise.all(listedScripts.map(async script => {
            const sql = await trackFile(fetchBestEffortText(
                httpClient,
                workbookFileUrl(baseUrl, script.name),
                MAX_SCRIPT_BYTES,
                signal,
            ), true);
            return sql == null ? null : { name: script.name, sql };
        }))).filter((script): script is ScriptData => script != null);

    totalBytes += scripts.reduce((bytes, script) => bytes + textBytes(script.sql), 0);
    const data = (await Promise.all(listedAttachments.map(async file => {
        const bytes = await trackFile(fetchBestEffortBytes(httpClient,
            new URL(`${STORAGE_ATTACHMENTS_FOLDER}/${encodeURIComponent(file.name)}`, baseUrl), MAX_TOTAL_BYTES, signal));
        return bytes == null ? null : { name: file.name, bytes };
    }))).filter((file): file is DataFileData => file != null);
    totalBytes += data.reduce((size, file) => size + file.bytes.byteLength, 0);
    // Optional files are loaded only while the workbook remains within the total budget. The
    // manifest is the sole required file, so an oversized optional tree degrades to metadata only.
    const includeOptionalFiles = totalBytes <= MAX_TOTAL_BYTES;

    // Scripts that failed to load are dropped from the list
    const bundle = assembleWorkbookBundle({
        workbook: {
            ...workbook,
            metadata: {
                ...workbook.metadata,
                originType: 'HTTP',
                originalHttpUrl: manifestUrl.toString(),
            },
        },
        catalogs: includeOptionalFiles ? head.catalogs : [],
    }, includeOptionalFiles ? scripts : [], includeOptionalFiles ? data : []);
    const loadedScriptCount = bundle.scripts.length;
    return {
        bundle,
        listedScriptCount,
        loadedScriptCount,
        incomplete: !head.filesValid || !includeOptionalFiles || loadedScriptCount !== listedScriptCount
            || data.length !== listedAttachments.length,
    };
}

/// The top-level files of a hosted workbook, fetched when a reader asks for them.
///
/// Each file is fetched at most once, a missing or unreadable file reads as null. The folder is
/// read-only, the workbook migration of the core changes it in memory.
class HttpFolder implements MigrationFolder {
    /// The URL of the workbook folder
    private readonly baseUrl: URL;
    /// The client that fetches the files
    private readonly httpClient: HttpClient;
    /// The maximum size of a file
    private readonly maxBytes: number;
    /// The signal that aborts the fetches
    private readonly signal: AbortSignal | undefined;
    /// The fetched files by name, null for missing ones
    private readonly files: Map<string, Promise<string | null>>;

    constructor(baseUrl: URL, httpClient: HttpClient, maxBytes: number, signal: AbortSignal | undefined, manifestName: string, manifestText: string) {
        this.baseUrl = baseUrl;
        this.httpClient = httpClient;
        this.maxBytes = maxBytes;
        this.signal = signal;
        this.files = new Map([[manifestName, Promise.resolve(manifestText)]]);
    }

    async exists(name: string): Promise<boolean> {
        return (await this.readText(name)) != null;
    }

    readText(name: string): Promise<string | null> {
        let file = this.files.get(name);
        if (file === undefined) {
            file = fetchBestEffortText(this.httpClient, new URL(name, this.baseUrl), this.maxBytes, this.signal);
            this.files.set(name, file);
        }
        return file;
    }

    async writeText(name: string): Promise<void> {
        throw new Error(`Cannot write ${name} of a remote workbook`);
    }

    async remove(name: string): Promise<void> {
        throw new Error(`Cannot remove ${name} of a remote workbook`);
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

function workbookFileUrl(baseUrl: URL, scriptName: string): URL {
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
