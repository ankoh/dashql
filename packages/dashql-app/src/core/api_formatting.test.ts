import * as dashql from './index.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL formatting', () => {
    it('instantiates WebAssembly module', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        script.parse();
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats with a null catalog', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        script.parse();
        const newScript = script.format(config, null);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats outdated scripts by parsing on demand', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        const newScript = script.format(config, null, true);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats with debug settings preamble and line width comments', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
            true,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "/* indentation=4, max_width=20 */\n" +
            "select 1 + b /*12*/\n" +
            "from foo;"
        );
    });

    it('breaks compact select target lists at max width', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select long, list, of, multiple, columns, exceeding, 42, without, line, break`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            42,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select long, list, of, multiple, columns,\n" +
            "  exceeding, 42, without, line, break;"
        );
    });

    it('breaks compact qualified names with leading dots', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 from memory.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1\n" +
            "from memory\n" +
            "  .bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n" +
            "  .cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc;"
        );
    });

    it('breaks compact expression chains at runtime', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1111111111+2222222222+3333333333`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1111111111 +\n" +
            "    2222222222 +\n" +
            "  3333333333;"
        );
    });

    it('formats order by direction and nulls rule', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select a, b from t order by a desc nulls last, b`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select a, b from t order by a desc nulls last, b;"
        );
    });

    it('formats constant interval casts', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select interval '30 days'`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select interval '30 days';"
        );
    });

    it('formats typed constant interval casts', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select interval '90' day`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select interval '90' day;"
        );
    });

    it('formats select star from table', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select * from part`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            120,
            2,
        );
        script.parse();
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select * from part;"
        );
    });

    it('formats select star from table with parseIfOutdated', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select * from part`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            120,
            2,
        );
        const newScript = script.format(config, null, true);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select * from part;"
        );
    });

    describe('with populated TPCH catalog', () => {
        const RELATIONS_SQL =
`-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: Demo script
-- Last Refresh: 2026-05-17T15:43:02.754Z

create table part (
   p_partkey integer not null,
   p_name varchar(55) not null,
   p_mfgr char(25) not null,
   p_brand char(10) not null,
   p_type varchar(25) not null,
   p_size integer not null,
   p_container char(10) not null,
   p_retailprice decimal(12,2) not null,
   p_comment varchar(23) not null,
   primary key (p_partkey)
);

create table supplier (
   s_suppkey integer not null,
   s_name char(25) not null,
   s_address varchar(40) not null,
   s_nationkey integer not null,
   s_phone char(15) not null,
   s_acctbal decimal(12,2) not null,
   s_comment varchar(101) not null,
   primary key (s_suppkey)
);

create table partsupp (
   ps_partkey integer not null,
   ps_suppkey integer not null,
   ps_availqty integer not null,
   ps_supplycost decimal(12,2) not null,
   ps_comment varchar(199) not null,
   primary key (ps_partkey,ps_suppkey)
);

create table customer (
   c_custkey integer not null,
   c_name varchar(25) not null,
   c_address varchar(40) not null,
   c_nationkey integer not null,
   c_phone char(15) not null,
   c_acctbal decimal(12,2) not null,
   c_mktsegment char(10) not null,
   c_comment varchar(117) not null,
   primary key (c_custkey)
);

create table orders (
   o_orderkey integer not null,
   o_custkey integer not null,
   o_orderstatus char(1) not null,
   o_totalprice decimal(12,2) not null,
   o_orderdate date not null,
   o_orderpriority char(15) not null,
   o_clerk char(15) not null,
   o_shippriority integer not null,
   o_comment varchar(79) not null,
   primary key (o_orderkey)
);

create table lineitem (
   l_orderkey integer not null,
   l_partkey integer not null,
   l_suppkey integer not null,
   l_linenumber integer not null,
   l_quantity decimal(12,2) not null,
   l_extendedprice decimal(12,2) not null,
   l_discount decimal(12,2) not null,
   l_tax decimal(12,2) not null,
   l_returnflag char(1) not null,
   l_linestatus char(1) not null,
   l_shipdate date not null,
   l_commitdate date not null,
   l_receiptdate date not null,
   l_shipinstruct char(25) not null,
   l_shipmode char(10) not null,
   l_comment varchar(44) not null,
   primary key (l_orderkey,l_linenumber)
);

create table nation (
   n_nationkey integer not null,
   n_name char(25) not null,
   n_regionkey integer not null,
   n_comment varchar(152) not null,
   primary key (n_nationkey)
);

create table "Region" (
   "r_regionkey" integer not null,
   "r_Name" char(25) not null,
   "r_Comment" varchar(152) not null,
   primary key ("r_regionkey")
);
`;

        const FUNCTIONS_SQL =
`-- DashQL Connection Functions.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: Demo script
-- Last Refresh: 2026-05-17T15:43:02.764Z

create function revenue(l_extendedprice decimal, l_discount decimal) returns decimal;
create function charge(l_extendedprice decimal, l_discount decimal, l_tax decimal) returns decimal;
create function days_between(start_date date, end_date date) returns integer;
`;

        function setupCatalog() {
            const catalog = dql!.createCatalog();

            const relationsScript = dql!.createScript(catalog);
            relationsScript.insertTextAt(0, RELATIONS_SQL);
            relationsScript.analyze();
            catalog.loadScript(relationsScript, 0);

            const functionsScript = dql!.createScript(catalog);
            functionsScript.insertTextAt(0, FUNCTIONS_SQL);
            functionsScript.analyze();
            catalog.loadScript(functionsScript, 0);

            return catalog;
        }

        it('formats select star from part', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, `select * from part`);
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                120,
                2,
            );
            const newScript = script.format(config, catalog, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).toEqual("select * from part;");
        });

        it('formats select star from part with null catalog', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, `select * from part`);
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                120,
                2,
            );
            const newScript = script.format(config, null, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).toEqual("select * from part;");
        });

        it('formats select star from part after analyze', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, `select * from part`);
            script.analyze();
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                120,
                2,
            );
            const newScript = script.format(config, null, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).toEqual("select * from part;");
        });

        it('formats select star from part at narrow width', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, `select * from part`);
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                10,
                2,
            );
            const newScript = script.format(config, null, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).toEqual("select *\nfrom part;");
        });

        it('formats the catalog relations script itself', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, RELATIONS_SQL);
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                120,
                2,
            );
            const newScript = script.format(config, null, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).not.toEqual("");
        });

        it('formats TPCH Q2 after analyze', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            const q2 = `select s_acctbal, s_name, n_name, p_partkey, p_mfgr, s_address, s_phone, s_comment from part, supplier, partsupp, nation, "Region" where p_partkey = ps_partkey and s_suppkey = ps_suppkey and p_size = 15 and p_type like '%BRASS' and s_nationkey = n_nationkey and n_regionkey = r_regionkey and "r_Name" = 'EUROPE' and ps_supplycost = (select min(ps_supplycost) from partsupp, supplier, nation, "Region" where p_partkey = ps_partkey and s_suppkey = ps_suppkey and s_nationkey = n_nationkey and n_regionkey = r_regionkey and "r_Name" = 'EUROPE') order by s_acctbal desc, n_name, s_name, p_partkey limit 100`;
            script.insertTextAt(0, q2);
            script.analyze();
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.DUCKDB,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                80,
                2,
            );
            const newScript = script.format(config, null, true);
            const newScriptText = newScript.toString();
            expect(newScriptText).not.toEqual("");
            expect(newScriptText).toContain("select");
            expect(newScriptText).toContain("from");
        });

        it('formats select * from part in all modes after analyze', async () => {
            const catalog = setupCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, `select * from part`);
            script.analyze();

            for (const mode of [
                dashql.buffers.formatting.FormattingMode.INLINE,
                dashql.buffers.formatting.FormattingMode.COMPACT,
                dashql.buffers.formatting.FormattingMode.PRETTY,
            ]) {
                const config = new dashql.buffers.formatting.FormattingConfigT(
                    dashql.buffers.formatting.FormattingDialect.DUCKDB,
                    mode,
                    120,
                    2,
                );
                const newScript = script.format(config, null, true);
                const newScriptText = newScript.toString();
                expect(newScriptText).toContain("select");
                expect(newScriptText).toContain("from part");
            }
        });
    });
});
