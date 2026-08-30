import type { HttpClient, HttpFetchResult } from '../../../platform/http/http_client.js';
import type {
    NotebookData,
    NotebookIndexData,
    NotebookIndexFolder,
    NotebookIndexScript,
    ScriptFolderData,
} from './storage_backend.js';
import {
    STORAGE_NOTEBOOK_FILE,
    STORAGE_NOTEBOOK_INDEX_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_DRAFT,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';
import type { NotebookBundle } from './notebook_bundle.js';
import { describeNotebookValidationError, validateNotebookData } from './notebook_validation.js';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FOLDERS = 256;
const MAX_SCRIPTS = 2048;

export interface HttpNotebookLoadResult {
    bundle: NotebookBundle;
    indexedScriptCount: number;
    loadedScriptCount: number;
    incomplete: boolean;
}

export type HttpNotebookLoadProgress =
    | { phase: 'preparing' }
    | { phase: 'manifest' }
    | { phase: 'index'; notebookName: string; notebookId: string }
    | {
        phase: 'files';
        notebookName: string;
        notebookId: string;
        completedFileCount: number;
        totalFileCount: number;
        completedScriptCount: number;
        totalScriptCount: number;
    };

export async function readNotebookBundleFromHttp(
    manifestUrl: URL,
    httpClient: HttpClient,
    signal?: AbortSignal,
    onProgress?: (progress: HttpNotebookLoadProgress) => void,
): Promise<HttpNotebookLoadResult> {
    validateManifestUrl(manifestUrl);
    const baseUrl = new URL('./', manifestUrl);
    let totalBytes = 0;

    onProgress?.({ phase: 'manifest' });
    const manifestText = await fetchRequiredText(httpClient, manifestUrl, STORAGE_NOTEBOOK_FILE, MAX_MANIFEST_BYTES, signal);
    totalBytes += textBytes(manifestText);
    const notebook = parseNotebook(manifestText);
    const notebookName = notebook.name?.trim() || notebook.metadata.originalFileName || 'Unnamed notebook';

    onProgress?.({ phase: 'index', notebookName, notebookId: notebook.notebookId });
    const indexText = await fetchBestEffortText(
        httpClient,
        new URL(STORAGE_NOTEBOOK_INDEX_FILE, baseUrl),
        MAX_INDEX_BYTES,
        signal,
    );
    totalBytes += indexText == null ? 0 : textBytes(indexText);
    const parsedIndex = parseNotebookIndex(indexText);
    const index = parsedIndex.index;
    const indexedScriptCount = index.folders.reduce((count, folder) => count + folder.scripts.length, 0);
    const totalFileCount = 5 + indexedScriptCount;
    let completedFileCount = 2;
    let completedScriptCount = 0;
    const reportFileProgress = () => onProgress?.({
        phase: 'files',
        notebookName,
        notebookId: notebook.notebookId,
        completedFileCount,
        totalFileCount,
        completedScriptCount,
        totalScriptCount: indexedScriptCount,
    });
    const trackFile = async (load: Promise<string | null>, script: boolean = false): Promise<string | null> => {
        try {
            return await load;
        } finally {
            completedFileCount += 1;
            if (script) completedScriptCount += 1;
            reportFileProgress();
        }
    };
    reportFileProgress();

    const optional = await Promise.all([
        trackFile(fetchBestEffortText(httpClient, new URL(STORAGE_SCRIPT_SCHEMA, baseUrl), MAX_SCRIPT_BYTES, signal)),
        trackFile(fetchBestEffortText(httpClient, new URL(STORAGE_SCRIPT_FUNCTIONS, baseUrl), MAX_SCRIPT_BYTES, signal)),
        trackFile(fetchBestEffortText(
            httpClient,
            new URL(`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`, baseUrl),
            MAX_SCRIPT_BYTES,
            signal,
        )),
    ]);

    const folders: ScriptFolderData[] = await Promise.all(index.folders.map(async folder => {
        const scripts = await Promise.all(folder.scripts.map(async script => {
            const sql = await trackFile(fetchBestEffortText(
                httpClient,
                notebookFileUrl(baseUrl, folder.name, script.name),
                MAX_SCRIPT_BYTES,
                signal,
            ), true);
            return sql == null ? null : { name: script.name, sql };
        }));
        return {
            name: folder.name,
            scripts: scripts.filter((script): script is NonNullable<typeof script> => script != null),
        };
    }));

    totalBytes += optional.reduce((bytes, text) => bytes + (text == null ? 0 : textBytes(text)), 0);
    totalBytes += folders.reduce(
        (folderBytes, folder) => folderBytes + folder.scripts.reduce((bytes, script) => bytes + textBytes(script.sql), 0),
        0,
    );
    // Optional files are loaded only while the notebook remains within the total budget. The
    // manifest is the sole required file, so an oversized optional tree degrades to metadata only.
    const includeOptionalFiles = totalBytes <= MAX_TOTAL_BYTES;

    const bundle: NotebookBundle = {
        notebook: {
            ...notebook,
            metadata: {
                ...notebook.metadata,
                originType: 'HTTP',
                originalHttpUrl: manifestUrl.toString(),
            },
        },
        schemaSql: includeOptionalFiles ? optional[0] : null,
        functionsSql: includeOptionalFiles ? optional[1] : null,
        folders: includeOptionalFiles ? folders : [],
        draftSql: includeOptionalFiles ? optional[2] : null,
    };
    const loadedScriptCount = bundle.folders.reduce((count, folder) => count + folder.scripts.length, 0);
    return {
        bundle,
        indexedScriptCount,
        loadedScriptCount,
        incomplete: !parsedIndex.valid || !includeOptionalFiles || loadedScriptCount !== indexedScriptCount,
    };
}

function validateManifestUrl(url: URL): void {
    const isPublicHttps = url.protocol === 'https:';
    const isBundledNotebook = url.protocol === 'app:' && url.hostname === 'bundle' && !url.port;
    const isDevelopmentLoopback = process.env.DASHQL_BUILD_MODE === 'development'
        && url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    if ((!isPublicHttps && !isBundledNotebook && !isDevelopmentLoopback) || url.username || url.password || url.hash) {
        throw new Error('Notebook URL must be public HTTPS, development loopback HTTP, or a bundled app URL without credentials or a fragment');
    }
    const name = url.pathname.split('/').pop();
    if (name !== STORAGE_NOTEBOOK_FILE) {
        throw new Error(`Remote notebook URL must end in ${STORAGE_NOTEBOOK_FILE}`);
    }
}

function parseNotebook(text: string): NotebookData {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Invalid remote notebook: invalid ${STORAGE_NOTEBOOK_FILE}`);
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid remote notebook: invalid ${STORAGE_NOTEBOOK_FILE}`);
    }
    const notebook = parsed as NotebookData;
    const validation = validateNotebookData(notebook);
    if (!validation.ok) {
        throw new Error(
            `Invalid remote notebook: invalid ${STORAGE_NOTEBOOK_FILE}: ${describeNotebookValidationError(validation.error)}`,
        );
    }
    return notebook;
}

function parseNotebookIndex(text: string | null): { index: NotebookIndexData; valid: boolean } {
    if (text == null) return { index: { folders: [] }, valid: false };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { index: { folders: [] }, valid: false };
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.folders)) {
        return { index: { folders: [] }, valid: false };
    }

    const folders: NotebookIndexFolder[] = [];
    const folderNames = new Set<string>();
    let scriptCount = 0;
    let valid = true;
    for (const value of parsed.folders) {
        if (folders.length >= MAX_FOLDERS) {
            valid = false;
            break;
        }
        if (!isPlainObject(value) || !isSafeName(value.name) || !Array.isArray(value.scripts)) {
            valid = false;
            continue;
        }
        const folderKey = destinationKey(value.name);
        if (folderNames.has(folderKey)) {
            valid = false;
            continue;
        }
        folderNames.add(folderKey);

        const scripts: NotebookIndexScript[] = [];
        const scriptNames = new Set<string>();
        for (const script of value.scripts) {
            if (scriptCount >= MAX_SCRIPTS) {
                valid = false;
                break;
            }
            if (!isPlainObject(script)
                || !isSafeName(script.name)
                || !script.name.toLowerCase().endsWith('.sql')
                || destinationKey(script.name) === destinationKey(STORAGE_SCRIPT_DRAFT)) {
                valid = false;
                continue;
            }
            const scriptKey = destinationKey(script.name);
            if (scriptNames.has(scriptKey)) {
                valid = false;
                continue;
            }
            scriptNames.add(scriptKey);
            scripts.push({ name: script.name.normalize('NFC') });
            scriptCount += 1;
        }
        folders.push({ name: value.name.normalize('NFC'), scripts });
    }
    return { index: { folders }, valid };
}

function notebookFileUrl(baseUrl: URL, folderName: string, scriptName: string): URL {
    return new URL(
        `${STORAGE_SCRIPTS_FOLDER}/${encodeURIComponent(folderName)}/${encodeURIComponent(scriptName)}`,
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
        throw new Error(`Failed to fetch remote notebook file ${label}: HTTP ${response.status}`);
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
        throw new Error(`Remote notebook file ${label} exceeds the maximum size`);
    }
    const text = await response.text();
    if (textBytes(text) > maxBytes) {
        throw new Error(`Remote notebook file ${label} exceeds the maximum size`);
    }
    return text;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeName(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 255
        && value !== '.'
        && value !== '..'
        && !value.includes('/')
        && !value.includes('\\')
        && !value.includes('\0');
}

function destinationKey(value: string): string {
    return value.normalize('NFC').toLowerCase();
}

function textBytes(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}
