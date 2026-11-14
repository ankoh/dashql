import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HyperDB, HyperDBConnection } from '../platform/hyperdb/hyperdb_wasm.js';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { createTestRoot } from '../tests/react_root.js';
import { CloudInstaller } from './cloud_installer.js';
import { CLOUD_DATABASE, CLOUD_MIGRATIONS, installCloudStore, type CloudMigration, type CloudQuery } from './cloud_store_schema.js';

// The installer runs on the embedded Hyper of the tests, the Hyper of Database.com speaks the same SQL

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;
let query: CloudQuery;
let root: ReturnType<typeof createTestRoot>;

/// The migrations of a newer DashQL, the last adds a column
const NEWER: CloudMigration[] = [...CLOUD_MIGRATIONS, { description: 'Add notes to scripts', columns: { workbook_scripts: [{ name: 'note', type: 'text', nullable: true }] } }];
/// The migrations of a DashQL whose last migration breaks older writers
const BREAKING: CloudMigration[] = [...CLOUD_MIGRATIONS, { ...NEWER[CLOUD_MIGRATIONS.length], breaks: 'writers' }];
/// The number of migrations of this DashQL
const KNOWN = CLOUD_MIGRATIONS.length;

beforeAll(async () => {
    const test = await createTestHyperDB('dashql-cloud-installer');
    database = test.database;
    dispose = test.dispose;
    connection = await database.connect();
    const path = await testDatabasePath(`dashql-cloud-installer-${crypto.randomUUID()}.hyper`);
    await connection.execute(`CREATE DATABASE "${path}"`);
    await connection.execute(`ATTACH DATABASE "${path}" AS "${CLOUD_DATABASE}"`);
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});
beforeEach(async () => {
    query = async (sql, signal) => await connection.query(sql, signal);
    await connection.execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
    root = createTestRoot();
});
afterEach(() => root.unmount());

const installer = () => root.container.querySelector<HTMLElement>('[data-testid="cloud-installer"]')!;
const summary = () => root.container.querySelector('[data-testid="cloud-installer-summary"]')!.textContent;
const steps = () => [...root.container.querySelectorAll<HTMLElement>('[data-testid="cloud-installer-step"]')]
    .map(step => [step.dataset.status, step.textContent]);
const stepDetails = () => [...root.container.querySelectorAll<HTMLElement>('[data-testid="cloud-installer-step"]')]
    .map(step => step.title);
const runButton = () => root.container.querySelector<HTMLButtonElement>('[data-testid="cloud-installer-run"]');
const settled = async (state: string) => await vi.waitFor(() => expect(installer().dataset.state).toBe(state), { timeout: 10_000 });

async function render(props: Partial<React.ComponentProps<typeof CloudInstaller>> = {}) {
    await root.render(<CloudInstaller query={query} {...props} />);
}

describe('cloud installer', () => {
    it('installs DashQL in a database without its tables', async () => {
        await render();
        await settled('missing');
        expect(summary()).toBe('Not installed');
        expect(steps()).toEqual([
            ['pending', 'Create the schema dashql'],
            ...CLOUD_MIGRATIONS.map(migration => ['pending', migration.description]),
        ]);
        // What a step changes is its tooltip
        expect(stepDetails()[1]).toMatch(/^Creates workbook_versions, .*workbook_folders$/);
        expect(runButton()!.textContent).toBe('Install');

        await act(async () => runButton()!.click());
        await settled('current');
        expect(summary()).toBe(`Installed, version ${KNOWN}`);
        expect(steps().map(([status]) => status)).toEqual(Array(KNOWN + 1).fill('done'));
        expect(runButton()).toBeNull();
        expect(Number((await connection.query(`SELECT version FROM "dashql"."dashql"."cloud_store"`)).get(0)!.version)).toBe(KNOWN);
    });

    it('updates the tables of an older DashQL', async () => {
        await installCloudStore(query);
        await render({ options: { migrations: NEWER } });
        await settled('outdated');
        expect(summary()).toBe(`Version ${KNOWN}, update to ${KNOWN + 1}`);
        expect(steps()).toEqual([['pending', 'Add notes to scripts']]);
        expect(stepDetails()).toEqual(['Adds note to workbook_scripts']);
        expect(runButton()!.textContent).toBe('Update');

        await act(async () => runButton()!.click());
        await settled('current');
        expect(steps()).toEqual([['done', 'Add notes to scripts']]);
        await connection.query(`SELECT note FROM "dashql"."dashql"."workbook_scripts" LIMIT 0`);
    });

    it('shows the step that failed and tries again', async () => {
        let fail = true;
        query = async (sql, signal) => {
            if (fail && sql.includes('ADD COLUMN "note"')) throw new Error('permission denied for table workbook_scripts');
            return await connection.query(sql, signal);
        };
        await installCloudStore(query);
        await render({ options: { migrations: NEWER } });
        await settled('outdated');
        await act(async () => runButton()!.click());
        await vi.waitFor(() => expect(runButton()?.textContent).toBe('Try Again'), { timeout: 10_000 });
        expect(root.container.querySelector('[role="alert"]')!.textContent).toBe('permission denied for table workbook_scripts');
        expect(steps().map(([status]) => status)).toEqual(['failed']);

        fail = false;
        await act(async () => runButton()!.click());
        await settled('current');
        expect(root.container.querySelector('[role="alert"]')?.textContent ?? null).toBeNull();
        expect(steps().map(([status]) => status)).toEqual(['done']);
    });

    it('tells that the connection reaches no database of DashQL', async () => {
        await render({ options: { database: 'nowhere' } });
        await settled('unreachable');
        expect(summary()).toBe('No database nowhere attached');
        expect(steps()).toEqual([]);
        expect(runButton()).toBeNull();
    });

    it('asks for a newer DashQL when a migration broke this one', async () => {
        await installCloudStore(query, { migrations: BREAKING });
        await render();
        await settled('newer');
        expect(summary()).toBe(`Version ${KNOWN + 1}, update DashQL to publish`);
        expect(runButton()).toBeNull();
    });
});
