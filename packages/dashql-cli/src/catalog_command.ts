// dashql catalog: the tables of the connections of a workbook folder as CREATE TABLE statements, from the catalog files
// of the folder (`connections/<id>/dashql-catalog-*.sql`) that the tab of DashQL writes into its copies and that a
// published workbook carries
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { readSessionConnections, SESSION_NAME_ENV } from './session_journal.js';

export const CATALOG_USAGE = `Usage: dashql catalog [--workspace <dir>] [--max-chars <n>] <workbook-dir> [<connection>...]

Prints the tables of connections as CREATE TABLE statements, the names and types of their columns: the named
connections by id or name, else every connection of the workbook. A connection that the agent may not use is marked.
The embedded Hyper lists the attachments of the workbook, scripts on it read them as :name.

The tables come from the catalog files of the workbook folder, connections/<id>/dashql-catalog-relations.sql, which
the tab of DashQL writes into the workbooks that it copied into the session and updates when it learns more about a
connection. A connection that ran no statement in the tab yet may list few tables. The output of a connection stops
after --max-chars characters, 100000 by default; grep the file for the rest.`;

/// The characters of the tables of a connection that are printed by default
const DEFAULT_MAX_CHARS = 100_000;

/// The catalog files of a connection in a workbook folder
export const CATALOG_RELATIONS_FILE = 'dashql-catalog-relations.sql';
export const CATALOG_FUNCTIONS_FILE = 'dashql-catalog-functions.sql';
/// The folder of the connections in a workbook folder
export const CATALOG_CONNECTIONS_FOLDER = 'connections';

/// A connection of a workbook folder
interface FolderConnection {
    connectionId: string;
    name: string;
    /// The connector, null for a connection that the workbook file doesn't list
    connector: string | null;
    /// The scripts of the workbook that run on it
    scripts: number;
}

/// The connector of the params of a connection, null without params
export function connectorOf(params: unknown): string | null {
    if (params == null || typeof params !== 'object') return null;
    const p = params as Record<string, { protocol?: unknown } | undefined>;
    if (p.hyper != null) return (p.hyper.protocol ?? 'WASM') === 'WASM' ? 'embedded Hyper' : 'Hyper';
    if (p.trino != null) return 'Trino';
    if (p.salesforce != null) return 'Salesforce Data 360';
    if (p.dbcom != null) return 'Salesforce Platform';
    return null;
}

/// The connections of a workbook folder: the ones of its workbook file, then the ones with catalog files
function folderConnections(dir: string, names: Map<string, string>): FolderConnection[] {
    let workbook: { connections?: unknown; scripts?: unknown };
    try {
        workbook = JSON.parse(readFileSync(path.join(dir, STORAGE_WORKBOOK_FILE), 'utf8')) as typeof workbook;
    } catch {
        workbook = {};
    }
    const scripts = Array.isArray(workbook.scripts) ? workbook.scripts as { connectionId?: unknown }[] : [];
    const connections = new Map<string, FolderConnection>();
    const add = (connectionId: string, name: string | null, params: unknown) => {
        if (connections.has(connectionId)) return;
        connections.set(connectionId, {
            connectionId,
            name: name ?? names.get(connectionId) ?? connectionId,
            connector: connectorOf(params),
            scripts: scripts.filter(script => script?.connectionId === connectionId).length,
        });
    };
    for (const connection of Array.isArray(workbook.connections) ? workbook.connections as Record<string, unknown>[] : []) {
        if (typeof connection?.connectionId !== 'string') continue;
        add(connection.connectionId, typeof connection.name === 'string' && connection.name.length > 0 ? connection.name : null, connection.params);
    }
    let folders: string[] = [];
    try {
        folders = readdirSync(path.join(dir, CATALOG_CONNECTIONS_FOLDER)).sort();
    } catch {
        // No catalog files
    }
    // The tab writes the catalogs of the other connections that the agent may use too
    for (const connectionId of folders) add(connectionId, null, null);
    return [...connections.values()];
}

/// A file of a workbook folder as text, null without one
function readText(file: string): string | null {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/// The statements of a text up to a number of characters, cut at the end of a line
function upTo(text: string, max: number): { text: string; cut: boolean } {
    if (text.length <= max) return { text, cut: false };
    const end = text.lastIndexOf('\n', max);
    return { text: text.slice(0, end > 0 ? end : max), cut: true };
}

/// Run `catalog` with the arguments after it, returns the exit code
export function runCatalog(args: string[], cli: CliProcess, session: string | null = process.env[SESSION_NAME_ENV] || null): number {
    let workspace = cli.cwd;
    let maxChars = DEFAULT_MAX_CHARS;
    const positional: string[] = [];
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg === '-h' || arg === '--help') {
            cli.stdout(`${CATALOG_USAGE}\n`);
            return EXIT_OK;
        }
        if (arg === '--workspace' && i + 1 < args.length) {
            workspace = path.resolve(cli.cwd, args[++i]);
        } else if (arg === '--max-chars' && i + 1 < args.length && /^\d+$/.test(args[i + 1])) {
            maxChars = Number(args[++i]);
        } else if (arg.startsWith('-')) {
            cli.stderr(`error: unknown option ${arg}\n\n${CATALOG_USAGE}\n`);
            return EXIT_USAGE;
        } else {
            positional.push(arg);
        }
    }
    const [workbook, ...wanted] = positional;
    if (workbook == null) {
        cli.stderr(`error: missing the workbook folder\n\n${CATALOG_USAGE}\n`);
        return EXIT_USAGE;
    }
    const dir = path.resolve(cli.cwd, workbook);
    if (readText(path.join(dir, STORAGE_WORKBOOK_FILE)) == null) {
        cli.stderr(`error: ${workbook} is no workbook folder, it has no ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }
    // The connections that the tab lets the agent use, with their names
    const allowed = readSessionConnections(workspace, session);
    const names = new Map(allowed?.connections.map(connection => [connection.connectionId, connection.name]) ?? []);
    const connections = folderConnections(dir, names);
    const matches = (connection: FolderConnection, name: string) =>
        connection.connectionId === name || connection.name.toLowerCase() === name.toLowerCase();
    const unknown = wanted.filter(name => !connections.some(connection => matches(connection, name)));
    if (unknown.length > 0) {
        cli.stderr(`error: the workbook knows no connection ${unknown.join(', ')}, its connections are ${connections.map(connection => `${connection.name} (${connection.connectionId})`).join(', ') || 'none'}\n`);
        return EXIT_USAGE;
    }
    const shown = wanted.length > 0 ? connections.filter(connection => wanted.some(name => matches(connection, name))) : connections;
    if (shown.length === 0) {
        cli.stdout('-- The workbook has no connections\n');
        return EXIT_FAILED;
    }
    const sections: string[] = [];
    for (const connection of shown) {
        const folder = path.join(dir, CATALOG_CONNECTIONS_FOLDER, connection.connectionId);
        const relations = readText(path.join(folder, CATALOG_RELATIONS_FILE))?.trim() ?? '';
        const functions = readText(path.join(folder, CATALOG_FUNCTIONS_FILE))?.trim() ?? '';
        const tables = (relations.match(/^\s*create\s+table\b/gim) ?? []).length;
        const notes = [
            ...(connection.connector == null ? [] : [connection.connector]),
            `${connection.scripts} script${connection.scripts === 1 ? '' : 's'}`,
            `${tables} table${tables === 1 ? '' : 's'}`,
        ];
        if (allowed != null && !allowed.connections.some(other => other.connectionId === connection.connectionId)) {
            notes.push('the tab of DashQL does not let the agent use it');
        }
        const lines = [`-- ${connection.name} (${connection.connectionId}): ${notes.join(', ')}`];
        if (relations.length === 0) lines.push('-- No tables known yet, the tab of DashQL writes them once it knows the catalog of the connection');
        else {
            const { text, cut } = upTo(relations, maxChars);
            lines.push(text);
            if (cut) lines.push(`-- Cut off after ${maxChars} characters, grep ${path.relative(cli.cwd, path.join(folder, CATALOG_RELATIONS_FILE))} for the rest`);
        }
        if (functions.length > 0) lines.push(`-- Functions`, upTo(functions, maxChars).text);
        if (connection.connector === 'embedded Hyper') {
            let attachments: string[] = [];
            try {
                attachments = readdirSync(path.join(dir, STORAGE_ATTACHMENTS_FOLDER)).filter(name => name.endsWith('.parquet')).sort();
            } catch {
                // No attachments
            }
            if (attachments.length > 0) {
                lines.push(`-- Attachments, scripts on the embedded Hyper read them as :name`);
                lines.push(...attachments.map(file => `--   :${file.slice(0, -'.parquet'.length)}  ${STORAGE_ATTACHMENTS_FOLDER}/${file}`));
            }
        }
        sections.push(lines.join('\n'));
    }
    cli.stdout(`${sections.join('\n\n')}\n`);
    return EXIT_OK;
}
