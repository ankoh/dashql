import * as webdb from '../src/';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000000;

export function testTPCH(db: () => webdb.AsyncWebDB, basePath: string) {
    let conn: webdb.AsyncWebDBConnection;

    beforeAll(async () => {
        const tables = ['nation', 'region', 'part', 'supplier', 'partsupp', 'customer', 'orders', 'lineitem'];
        for (const t of tables) {
            await db().registerURL(`${basePath}/${t}.parquet`);
        }
    });

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    // perform queries

    const queries: string[] = [
        `
    select
        l_returnflag,
        l_linestatus,
        sum(l_quantity) as sum_qty,
        sum(l_extendedprice) as sum_base_price,
        sum(l_extendedprice * (1 - l_discount)) as sum_disc_price,
        sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge,
        avg(l_quantity) as avg_qty,
        avg(l_extendedprice) as avg_price,
        avg(l_discount) as avg_disc,
        count(*) as count_order
    from
        parquet_scan('${basePath}/lineitem.parquet') lineitem
    where
        l_shipdate::DATE <= date '1996-12-01' - interval '86' day
    group by
        l_returnflag,
        l_linestatus
    order by
        l_returnflag,
        l_linestatus`,
        /*
        `
    select
        s_acctbal,
        s_name,
        n_name,
        p_partkey,
        p_mfgr,
        s_address,
        s_phone,
        s_comment
    from
        parquet_scan('${basePath}/part.parquet') part,
        parquet_scan('${basePath}/supplier.parquet') supplier,
        parquet_scan('${basePath}/partsupp.parquet') partsupp,
        parquet_scan('${basePath}/nation.parquet') nation,
        parquet_scan('${basePath}/region.parquet') region
    where
        p_partkey = ps_partkey
        and s_suppkey = ps_suppkey
        and p_size = 36
        and p_type like '%NICKEL'
        and s_nationkey = n_nationkey
        and n_regionkey = r_regionkey
        and r_name = 'MIDDLE EAST'
        and ps_supplycost = (
            select
                min(ps_supplycost)
            from
                parquet_scan('${basePath}/partsupp.parquet') partsupp,
                parquet_scan('${basePath}/supplier.parquet') supplier,
                parquet_scan('${basePath}/nation.parquet') nation,
                parquet_scan('${basePath}/region.parquet') region
            where
                p_partkey = ps_partkey
                and s_suppkey = ps_suppkey
                and s_nationkey = n_nationkey
                and n_regionkey = r_regionkey
                and r_name = 'MIDDLE EAST'
        )
    order by
        s_acctbal desc,
        n_name,
        s_name,
        p_partkey`,
        `
    select
        l_orderkey,
        sum(l_extendedprice * (1 - l_discount)) as revenue,
        o_orderdate,
        o_shippriority
    from
        parquet_scan('${basePath}/customer.parquet') customer,
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/lineitem.parquet') lineitem
    where
        c_mktsegment = 'BUILDING'
        and c_custkey = o_custkey
        and l_orderkey = o_orderkey
        and o_orderdate < date '1995-03-26'
        and l_shipdate > date '1995-03-26'
    group by
        l_orderkey,
        o_orderdate,
        o_shippriority
    order by
        revenue desc,
        o_orderdate`,
        `
    select
        o_orderpriority,
        count(*) as order_count
    from
        parquet_scan('${basePath}/orders.parquet') orders
    where
        o_orderdate >= date '1996-11-01'
        and o_orderdate < date '1996-11-01' + interval '3' month
        and exists (
            select
                *
            from
            parquet_scan('${basePath}/lineitem.parquet') lineitem
            where
                l_orderkey = o_orderkey
                and l_commitdate < l_receiptdate
        )
    group by
        o_orderpriority
    order by
        o_orderpriority`,
        `
    select
        n_name,
        sum(l_extendedprice * (1 - l_discount)) as revenue
    from
        parquet_scan('${basePath}/customer.parquet') customer,
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/lineitem.parquet') lineitem,
        parquet_scan('${basePath}/supplier.parquet') supplier,
        parquet_scan('${basePath}/nation.parquet') nation,
        parquet_scan('${basePath}/region.parquet') region
    where
        c_custkey = o_custkey
        and l_orderkey = o_orderkey
        and l_suppkey = s_suppkey
        and c_nationkey = s_nationkey
        and s_nationkey = n_nationkey
        and n_regionkey = r_regionkey
        and r_name = 'ASIA'
        and o_orderdate >= date '1997-01-01'
        and o_orderdate < date '1997-01-01' + interval '1' year
    group by
        n_name
    order by
        revenue desc`,
        `
    select
        sum(l_extendedprice * l_discount) as revenue
    from
        parquet_scan('${basePath}/lineitem.parquet') lineitem
    where
        l_shipdate >= date '1997-01-01'
        and l_shipdate < date '1997-01-01' + interval '1' year
        and l_discount between 0.06 - 0.01 and 0.06 + 0.01
        and l_quantity < 25`,
        `
    select
        supp_nation,
        cust_nation,
        l_year,
        sum(volume) as revenue
    from
        (
            select
                n1.n_name as supp_nation,
                n2.n_name as cust_nation,
                extract(year from l_shipdate) as l_year,
                l_extendedprice * (1 - l_discount) as volume
            from
                parquet_scan('${basePath}/supplier.parquet') supplier,
                parquet_scan('${basePath}/lineitem.parquet') lineitem,
                parquet_scan('${basePath}/orders.parquet') orders,
                parquet_scan('${basePath}/customer.parquet') customer,
                parquet_scan('${basePath}/nation.parquet') n1,
                parquet_scan('${basePath}/nation.parquet') n2
            where
                s_suppkey = l_suppkey
                and o_orderkey = l_orderkey
                and c_custkey = o_custkey
                and s_nationkey = n1.n_nationkey
                and c_nationkey = n2.n_nationkey
                and (
                    (n1.n_name = 'JORDAN' and n2.n_name = 'RUSSIA')
                    or (n1.n_name = 'RUSSIA' and n2.n_name = 'JORDAN')
                )
                and l_shipdate between date '1995-01-01' and date '1996-12-31'
        ) as shipping
    group by
        supp_nation,
        cust_nation,
        l_year
    order by
        supp_nation,
        cust_nation,
        l_year`,
        `
    select
        o_year,
        sum(case
            when nation = 'RUSSIA' then volume
            else 0
        end) / sum(volume) as mkt_share
    from
        (
            select
                extract(year from o_orderdate) as o_year,
                l_extendedprice * (1 - l_discount) as volume,
                n2.n_name as nation
            from
                parquet_scan('${basePath}/part.parquet') part,
                parquet_scan('${basePath}/supplier.parquet') supplier,
                parquet_scan('${basePath}/lineitem.parquet') lineitem,
                parquet_scan('${basePath}/orders.parquet') orders,
                parquet_scan('${basePath}/customer.parquet') customer,
                parquet_scan('${basePath}/nation.parquet') n1,
                parquet_scan('${basePath}/nation.parquet') n2,
                parquet_scan('${basePath}/region.parquet') region
            where
                p_partkey = l_partkey
                and s_suppkey = l_suppkey
                and l_orderkey = o_orderkey
                and o_custkey = c_custkey
                and c_nationkey = n1.n_nationkey
                and n1.n_regionkey = r_regionkey
                and r_name = 'EUROPE'
                and s_nationkey = n2.n_nationkey
                and o_orderdate between date '1995-01-01' and date '1996-12-31'
                and p_type = 'LARGE ANODIZED COPPER'
        ) as all_nations
    group by
        o_year
    order by
        o_year`,
        `
    select
        nation,
        o_year,
        sum(amount) as sum_profit
    from
        (
            select
                n_name as nation,
                extract(year from o_orderdate) as o_year,
                l_extendedprice * (1 - l_discount) - ps_supplycost * l_quantity as amount
            from
                parquet_scan('${basePath}/part.parquet') part,
                parquet_scan('${basePath}/supplier.parquet') supplier,
                parquet_scan('${basePath}/lineitem.parquet') lineitem,
                parquet_scan('${basePath}/partsupp.parquet') partsupp,
                parquet_scan('${basePath}/orders.parquet') orders,
                parquet_scan('${basePath}/nation.parquet') nation
            where
                s_suppkey = l_suppkey
                and ps_suppkey = l_suppkey
                and ps_partkey = l_partkey
                and p_partkey = l_partkey
                and o_orderkey = l_orderkey
                and s_nationkey = n_nationkey
                and p_name like '%maroon%'
        ) as profit
    group by
        nation,
        o_year
    order by
        nation,
        o_year desc`,
        `
    select
        c_custkey,
        c_name,
        sum(l_extendedprice * (1 - l_discount)) as revenue,
        c_acctbal,
        n_name,
        c_address,
        c_phone,
        c_comment
    from
        parquet_scan('${basePath}/customer.parquet') customer,
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/lineitem.parquet') lineitem,
        parquet_scan('${basePath}/nation.parquet') nation
    where
        c_custkey = o_custkey
        and l_orderkey = o_orderkey
        and o_orderdate >= date '1993-03-01'
        and o_orderdate < date '1993-03-01' + interval '3' month
        and l_returnflag = 'R'
        and c_nationkey = n_nationkey
    group by
        c_custkey,
        c_name,
        c_acctbal,
        c_phone,
        n_name,
        c_address,
        c_comment
    order by
        revenue desc`,
        `
    select
        ps_partkey,
        sum(ps_supplycost * ps_availqty) as value
    from
        parquet_scan('${basePath}/partsupp.parquet') partsupp,
        parquet_scan('${basePath}/supplier.parquet') supplier,
        parquet_scan('${basePath}/nation.parquet') nation
    where
        ps_suppkey = s_suppkey
        and s_nationkey = n_nationkey
        and n_name = 'KENYA'
    group by
        ps_partkey having
            sum(ps_supplycost * ps_availqty) > (
                select
                    sum(ps_supplycost * ps_availqty) * 0.0001000000
                from
                    parquet_scan('${basePath}/partsupp.parquet') partsupp,
                    parquet_scan('${basePath}/supplier.parquet') supplier,
                    parquet_scan('${basePath}/nation.parquet') nation
                where
                    ps_suppkey = s_suppkey
                    and s_nationkey = n_nationkey
                    and n_name = 'KENYA'
            )
    order by
        value desc`,
        `
    select
        l_shipmode,
        sum(case
            when o_orderpriority = '1-URGENT'
                or o_orderpriority = '2-HIGH'
                then 1
            else 0
        end) as high_line_count,
        sum(case
            when o_orderpriority <> '1-URGENT'
                and o_orderpriority <> '2-HIGH'
                then 1
            else 0
        end) as low_line_count
    from
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/lineitem.parquet') lineitem
    where
        o_orderkey = l_orderkey
        and l_shipmode in ('AIR', 'SHIP')
        and l_commitdate < l_receiptdate
        and l_shipdate < l_commitdate
        and l_receiptdate >= date '1997-01-01'
        and l_receiptdate < date '1997-01-01' + interval '1' year
    group by
        l_shipmode
    order by
        l_shipmode`,
        `
    select
        c_count,
        count(*) as custdist
    from
        (
            select
                c_custkey,
                count(o_orderkey)
            from
                parquet_scan('${basePath}/customer.parquet') customer 
            left outer join parquet_scan('${basePath}/orders.parquet') orders on
                c_custkey = o_custkey
                and o_comment not like '%express%deposits%'
            group by
                c_custkey
        ) as c_orders (c_custkey, c_count)
    group by
        c_count
    order by
        custdist desc,
        c_count desc`,
        `
    select
        100.00 * sum(case
            when p_type like 'PROMO%'
                then l_extendedprice * (1 - l_discount)
            else 0
        end) / sum(l_extendedprice * (1 - l_discount)) as promo_revenue
    from
        parquet_scan('${basePath}/lineitem.parquet') lineitem,
        parquet_scan('${basePath}/part.parquet') part
    where
        l_partkey = p_partkey
        and l_shipdate >= date '1997-09-01'
        and l_shipdate < date '1997-09-01' + interval '1' month`,
        `
    create view revenue0 (supplier_no, total_revenue) as
        select
            l_suppkey,
            sum(l_extendedprice * (1 - l_discount))
        from
            parquet_scan('${basePath}/lineitem.parquet') lineitem
        where
            l_shipdate >= date '1994-10-01'
            and l_shipdate < date '1994-10-01' + interval '3' month
        group by
            l_suppkey;
    
    
    select
        s_suppkey,
        s_name,
        s_address,
        s_phone,
        total_revenue
    from
        parquet_scan('${basePath}/supplier.parquet') supplier,
        revenue0
    where
        s_suppkey = supplier_no
        and total_revenue = (
            select
                max(total_revenue)
            from
                revenue0
        )
    order by
        s_suppkey;
    
    drop view revenue0`,
        `
    select
        p_brand,
        p_type,
        p_size,
        count(distinct ps_suppkey) as supplier_cnt
    from
        parquet_scan('${basePath}/partsupp.parquet') partsupp,
        parquet_scan('${basePath}/part.parquet') part
    where
        p_partkey = ps_partkey
        and p_brand <> 'Brand#23'
        and p_type not like 'LARGE PLATED%'
        and p_size in (7, 16, 27, 18, 29, 15, 26, 23)
        and ps_suppkey not in (
            select
                s_suppkey
            from
            parquet_scan('${basePath}/supplier.parquet') supplier
            where
                s_comment like '%Customer%Complaints%'
        )
    group by
        p_brand,
        p_type,
        p_size
    order by
        supplier_cnt desc,
        p_brand,
        p_type,
        p_size`,
        `
    select
        sum(l_extendedprice) / 7.0 as avg_yearly
    from
        parquet_scan('${basePath}/lineitem.parquet') lineitem,
        parquet_scan('${basePath}/part.parquet') part
    where
        p_partkey = l_partkey
        and p_brand = 'Brand#33'
        and p_container = 'SM PKG'
        and l_quantity < (
            select
                0.2 * avg(l_quantity)
            from
            parquet_scan('${basePath}/lineitem.parquet') lineitem
            where
                l_partkey = p_partkey
        )`,
        `
    select
        c_name,
        c_custkey,
        o_orderkey,
        o_orderdate,
        o_totalprice,
        sum(l_quantity)
    from
        parquet_scan('${basePath}/customer.parquet') customer,
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/lineitem.parquet') lineitem
    where
        o_orderkey in (
            select
                l_orderkey
            from
                parquet_scan('${basePath}/lineitem.parquet') lineitem
            group by
                l_orderkey having
                    sum(l_quantity) > 314
        )
        and c_custkey = o_custkey
        and o_orderkey = l_orderkey
    group by
        c_name,
        c_custkey,
        o_orderkey,
        o_orderdate,
        o_totalprice
    order by
        o_totalprice desc,
        o_orderdate`,
        `
    select
        sum(l_extendedprice* (1 - l_discount)) as revenue
    from
        parquet_scan('${basePath}/lineitem.parquet') lineitem,
        parquet_scan('${basePath}/part.parquet') part
    where
        (
            p_partkey = l_partkey
            and p_brand = 'Brand#12'
            and p_container in ('SM CASE', 'SM BOX', 'SM PACK', 'SM PKG')
            and l_quantity >= 5 and l_quantity <= 5 + 10
            and p_size between 1 and 5
            and l_shipmode in ('AIR', 'AIR REG')
            and l_shipinstruct = 'DELIVER IN PERSON'
        )
        or
        (
            p_partkey = l_partkey
            and p_brand = 'Brand#32'
            and p_container in ('MED BAG', 'MED BOX', 'MED PKG', 'MED PACK')
            and l_quantity >= 13 and l_quantity <= 13 + 10
            and p_size between 1 and 10
            and l_shipmode in ('AIR', 'AIR REG')
            and l_shipinstruct = 'DELIVER IN PERSON'
        )
        or
        (
            p_partkey = l_partkey
            and p_brand = 'Brand#32'
            and p_container in ('LG CASE', 'LG BOX', 'LG PACK', 'LG PKG')
            and l_quantity >= 28 and l_quantity <= 28 + 10
            and p_size between 1 and 15
            and l_shipmode in ('AIR', 'AIR REG')
            and l_shipinstruct = 'DELIVER IN PERSON'
        )`,
        `
    select
        s_name,
        s_address
    from
        parquet_scan('${basePath}/supplier.parquet') supplier,
        parquet_scan('${basePath}/nation.parquet') nation
    where
        s_suppkey in (
            select
                ps_suppkey
            from
                parquet_scan('${basePath}/partsupp.parquet') partsupp
            where
                ps_partkey in (
                    select
                        p_partkey
                    from
                        parquet_scan('${basePath}/part.parquet') part
                    where
                        p_name like 'floral%'
                )
                and ps_availqty > (
                    select
                        0.5 * sum(l_quantity)
                    from
                        parquet_scan('${basePath}/lineitem.parquet') lineitem
                    where
                        l_partkey = ps_partkey
                        and l_suppkey = ps_suppkey
                        and l_shipdate >= date '1995-01-01'
                        and l_shipdate < date '1995-01-01' + interval '1' year
                )
        )
        and s_nationkey = n_nationkey
        and n_name = 'GERMANY'
    order by
        s_name`,
        `
    select
        s_name,
        count(*) as numwait
    from
        parquet_scan('${basePath}/supplier.parquet') supplier,
        parquet_scan('${basePath}/lineitem.parquet') l1,
        parquet_scan('${basePath}/orders.parquet') orders,
        parquet_scan('${basePath}/nation.parquet') nation
    where
        s_suppkey = l1.l_suppkey
        and o_orderkey = l1.l_orderkey
        and o_orderstatus = 'F'
        and l1.l_receiptdate > l1.l_commitdate
        and exists (
            select
                *
            from
                parquet_scan('${basePath}/lineitem.parquet') l2
            where
                l2.l_orderkey = l1.l_orderkey
                and l2.l_suppkey <> l1.l_suppkey
        )
        and not exists (
            select
                *
            from
                parquet_scan('${basePath}/lineitem.parquet') l3
            where
                l3.l_orderkey = l1.l_orderkey
                and l3.l_suppkey <> l1.l_suppkey
                and l3.l_receiptdate > l3.l_commitdate
        )
        and s_nationkey = n_nationkey
        and n_name = 'JAPAN'
    group by
        s_name
    order by
        numwait desc,
        s_name`,
        `
    select
        cntrycode,
        count(*) as numcust,
        sum(c_acctbal) as totacctbal
    from
        (
            select
                substring(c_phone from 1 for 2) as cntrycode,
                c_acctbal
            from
                parquet_scan('${basePath}/customer.parquet') customer
            where
                substring(c_phone from 1 for 2) in
                    ('17', '23', '16', '22', '21', '31', '14')
                and c_acctbal > (
                    select
                        avg(c_acctbal)
                    from
                        parquet_scan('${basePath}/customer.parquet') customer
                    where
                        c_acctbal > 0.00
                        and substring(c_phone from 1 for 2) in
                            ('17', '23', '16', '22', '21', '31', '14')
                )
                and not exists (
                    select
                        *
                    from
                        parquet_scan('${basePath}/orders.parquet') orders
                    where
                        o_custkey = c_custkey
                )
        ) as custsale
    group by
        cntrycode
    order by
        cntrycode`,*/
    ];

    describe('TPCH', () => {
        describe('duckdb regression', () => {
            it('first aggregation, was fine', async () => {
                let result = await conn.runQuery(
                    `
                select
                    sum(l_quantity) as sum_qty
                from
                    parquet_scan('${basePath}/lineitem.parquet') lineitem
                where
                    l_shipdate::DATE <= date '1996-12-01' - interval '86' day`,
                );
                const chunks = new webdb.StaticChunkIterator(result);
                const rows = chunks.collectAllBlocking();
                expect(rows[0].__attribute__(0)).not.toBeNull();
            }, 300000);
            it('second aggregation, was fine', async () => {
                let result = await conn.runQuery(
                    `
                select
                    sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge
                from
                    parquet_scan('${basePath}/lineitem.parquet') lineitem
                where
                    l_shipdate::DATE <= date '1996-12-01' - interval '86' day`,
                );
                const chunks = new webdb.StaticChunkIterator(result);
                const rows = chunks.collectAllBlocking();
                expect(rows[0].__attribute__(0)).not.toBeNull();
            }, 300000);
            it('both aggregations, was failing', async () => {
                debugger;
                let result = await conn.runQuery(
                    `
                select
                    sum(l_quantity) as sum_qty,
                    sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge
                from
                    parquet_scan('${basePath}/lineitem.parquet') lineitem
                where
                    l_shipdate::DATE <= date '1996-12-01' - interval '86' day`,
                );
                const chunks = new webdb.StaticChunkIterator(result);
                const rows = chunks.collectAllBlocking();
                expect(rows[0].__attribute__(0)).not.toBeNull();
                expect(rows[0].__attribute__(1)).not.toBeNull();
            }, 300000);
        });

        /*it('blocking static chunks', async () => {
            // for (const query of queries) {
            //     let result = await conn.runQuery(query);
            //     const chunks = new webdb.StaticChunkIterator(result);
            //     expect(chunks.collectAllBlocking()).not.toHaveSize(0);
            // }
            let result = await conn.runQuery(
                `
            select
                sum(l_quantity) as sum_qty,
                sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge
            from
                parquet_scan('${basePath}/lineitem.parquet') lineitem
            where
                l_shipdate::DATE <= date '1996-12-01' - interval '86' day`,
            );
            const chunks = new webdb.StaticChunkIterator(result);
            const rows = chunks.collectAllBlocking();
            console.log(
                rows.map((row: any) => {
                    let o: any = {};
                    rows.columns!.forEach((l: string) => (o[l] = row[l]));
                    return o;
                }),
            );
        });*/
    });
}
