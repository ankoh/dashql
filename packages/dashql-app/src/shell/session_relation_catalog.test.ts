// @vitest-environment node
import { DashQLShell } from './api.js';
import { ShellSessionRelationCatalog } from './session_relation_catalog.js';

declare const DASHQL_SHELL_PRECOMPILED: Promise<Uint8Array>;

describe('shell session relation catalog', () => {
    let shell: DashQLShell;
    let catalog: ShellSessionRelationCatalog;

    beforeEach(async () => {
        shell = await DashQLShell.create({
            environment: { executeQuery: async () => new Uint8Array() },
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
        catalog = new ShellSessionRelationCatalog(shell);
    });

    afterEach(() => {
        catalog.destroy();
        shell.destroy();
    });

    it('starts with an empty generated catalog', () => {
        expect(catalog.getScriptText()).toBe('-- Relations created during this shell session.');
    });

    it('tracks tables with default, schema-qualified, and database-qualified names', () => {
        catalog.applySuccessfulQuery('CREATE TABLE orders (order_id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE analytics.customers (customer_id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE warehouse.reporting.events (event_id BIGINT)');

        expect(catalog.getScriptText()).toBe(
            '-- Relations created during this shell session.\n\n' +
            'CREATE TABLE "analytics"."customers" (\n' +
            '    "customer_id" VARCHAR\n' +
            ');\n\n' +
            'CREATE TABLE "public"."orders" (\n' +
            '    "order_id" VARCHAR\n' +
            ');\n\n' +
            'CREATE TABLE "warehouse"."reporting"."events" (\n' +
            '    "event_id" VARCHAR\n' +
            ');',
        );
    });

    it('tracks derived columns for CTAS, views, and SELECT INTO', () => {
        catalog.applySuccessfulQuery('CREATE TABLE source (id BIGINT, amount DOUBLE)');
        catalog.applySuccessfulQuery('CREATE TABLE totals AS SELECT id, amount AS total FROM source');
        catalog.applySuccessfulQuery('CREATE VIEW report AS SELECT * FROM totals');
        catalog.applySuccessfulQuery('SELECT id AS copied_id INTO copied FROM source');

        expect(catalog.getScriptText()).toContain('"totals" (\n    "id" VARCHAR,\n    "total" VARCHAR');
        expect(catalog.getScriptText()).toContain('"report" (\n    "id" VARCHAR,\n    "total" VARCHAR');
        expect(catalog.getScriptText()).toContain('"copied" (\n    "copied_id" VARCHAR');
    });

    it('replaces a relation descriptor when the same target is created again', () => {
        catalog.applySuccessfulQuery('CREATE TABLE inventory (old_id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE inventory (new_id BIGINT, quantity INTEGER)');

        expect(catalog.getScriptText()).not.toContain('"old_id"');
        expect(catalog.getScriptText()).toContain(
            'CREATE TABLE "public"."inventory" (\n' +
            '    "new_id" VARCHAR,\n' +
            '    "quantity" VARCHAR\n' +
            ');',
        );
        expect(catalog.getScriptText().match(/CREATE TABLE/g)).toHaveLength(1);
    });

    it('drops only the relation matching the complete qualified target', () => {
        catalog.applySuccessfulQuery('CREATE TABLE public.events (public_id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE analytics.events (analytics_id BIGINT)');
        catalog.applySuccessfulQuery('DROP TABLE analytics.events');

        expect(catalog.getScriptText()).toContain('"public"."events"');
        expect(catalog.getScriptText()).not.toContain('"analytics"."events"');
        expect(catalog.getScriptText()).toContain('"public_id"');
    });

    it('drops views and treats IF EXISTS as the same target', () => {
        catalog.applySuccessfulQuery('CREATE VIEW active_orders AS SELECT 1 AS order_id');
        catalog.applySuccessfulQuery('DROP VIEW IF EXISTS active_orders');

        expect(catalog.getScriptText()).toBe('-- Relations created during this shell session.');
    });

    it('quotes relation and column identifiers in generated SQL', () => {
        catalog.applySuccessfulQuery('CREATE TABLE "odd""schema"."order""items" ("line""id" BIGINT)');

        expect(catalog.getScriptText()).toContain(
            'CREATE TABLE "odd""schema"."order""items" (\n' +
            '    "line""id" VARCHAR\n' +
            ');',
        );

        catalog.applySuccessfulQuery('DROP TABLE "odd""schema"."order""items"');
        expect(catalog.getScriptText()).toBe('-- Relations created during this shell session.');
    });

    it('renders relations in stable qualified-name order', () => {
        catalog.applySuccessfulQuery('CREATE TABLE zeta (id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE analytics.beta (id BIGINT)');
        catalog.applySuccessfulQuery('CREATE TABLE alpha (id BIGINT)');

        const script = catalog.getScriptText();
        expect(script.indexOf('"analytics"."beta"')).toBeLessThan(script.indexOf('"public"."alpha"'));
        expect(script.indexOf('"public"."alpha"')).toBeLessThan(script.indexOf('"public"."zeta"'));
    });

    it.each([
        ['non-DDL statements', 'SELECT 1'],
        ['attach statements', 'ATTACH DATABASE "source.hyper" AS source'],
        ['multiple statements', 'CREATE TABLE first (id BIGINT); CREATE TABLE second (id BIGINT)'],
        ['statements with parser errors', 'CREATE TABLE broken ('],
        ['empty queries', ''],
    ])('ignores %s', (_description, query) => {
        const before = catalog.getScriptText();

        catalog.applySuccessfulQuery(query);

        expect(catalog.getScriptText()).toBe(before);
    });
});
