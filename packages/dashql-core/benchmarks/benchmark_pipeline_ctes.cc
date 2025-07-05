#include <sstream>
#include <string_view>

#include "benchmark/benchmark.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/script.h"

using namespace dashql;

static const std::string_view TPCH_SCHEMA = R"SQL(
create table part (p_partkey integer not null, p_name varchar(55) not null, p_mfgr char(25) not null, p_brand char(10) not null, p_type varchar(25) not null, p_size integer not null, p_container char(10) not null, p_retailprice decimal(12,2) not null, p_comment varchar(23) not null, primary key (p_partkey));
create table supplier (s_suppkey integer not null, s_name char(25) not null, s_address varchar(40) not null, s_nationkey integer not null, s_phone char(15) not null, s_acctbal decimal(12,2) not null, s_comment varchar(101) not null, primary key (s_suppkey));
create table partsupp (ps_partkey integer not null, ps_suppkey integer not null, ps_availqty integer not null, ps_supplycost decimal(12,2) not null, ps_comment varchar(199) not null, primary key (ps_partkey,ps_suppkey));
create table customer (c_custkey integer not null, c_name varchar(25) not null, c_address varchar(40) not null, c_nationkey integer not null, c_phone char(15) not null, c_acctbal decimal(12,2) not null, c_mktsegment char(10) not null, c_comment varchar(117) not null, primary key (c_custkey));
create table orders (o_orderkey integer not null, o_custkey integer not null, o_orderstatus char(1) not null, o_totalprice decimal(12,2) not null, o_orderdate date not null, o_orderpriority char(15) not null, o_clerk char(15) not null, o_shippriority integer not null, o_comment varchar(79) not null, primary key (o_orderkey));
create table lineitem (l_orderkey integer not null, l_partkey integer not null, l_suppkey integer not null, l_linenumber integer not null, l_quantity decimal(12,2) not null, l_extendedprice decimal(12,2) not null, l_discount decimal(12,2) not null, l_tax decimal(12,2) not null, l_returnflag char(1) not null, l_linestatus char(1) not null, l_shipdate date not null, l_commitdate date not null, l_receiptdate date not null, l_shipinstruct char(25) not null, l_shipmode char(10) not null, l_comment varchar(44) not null, primary key (l_orderkey,l_linenumber));
create table nation (n_nationkey integer not null, n_name char(25) not null, n_regionkey integer not null, n_comment varchar(152) not null, primary key (n_nationkey));
create table region (r_regionkey integer not null, r_name char(25) not null, r_comment varchar(152) not null, primary key (r_regionkey));
)SQL";

static const std::string_view TPCH_1 = R"SQL(
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
    lineitem
where
    l_shipdate &#60;= date '1998-12-01' - interval '90' day
group by
    l_returnflag,
    l_linestatus
order by
    l_returnflag,
    l_linestatus
)SQL";

std::string generate_query(size_t cte_count) {
    std::stringstream out;
    if (cte_count > 0) {
        out << "WITH cte_0 AS (\n" << TPCH_1 << ")\n";
    }
    for (size_t i = 1; i < cte_count; ++i) {
        out << ", cte_" << i << " AS (\n" << TPCH_1 << ")\n";
    }
    out << "select 1" << std::endl;
    return out.str();
}

static void scan_query(benchmark::State& state) {
    Catalog catalog;

    Script schema{catalog, 2};
    schema.InsertTextAt(0, TPCH_SCHEMA);
    catalog.LoadScript(schema, 0);

    size_t cte_count = state.range(0);
    auto sql = generate_query(cte_count);

    Script main{catalog, 10};
    main.InsertTextAt(0, sql);

    // Dry run
    if (auto status = main.Analyze(); status != buffers::status::StatusCode::OK) {
        std::cerr << "dry run failed with status: " << buffers::status::EnumNameStatusCode(status) << std::endl;
    }
    for (auto _ : state) {
        main.Scan();
    }
}

static void parse_query(benchmark::State& state) {
    Catalog catalog;

    Script schema{catalog, 2};
    schema.InsertTextAt(0, TPCH_SCHEMA);
    catalog.LoadScript(schema, 0);

    size_t cte_count = state.range(0);
    auto sql = generate_query(cte_count);

    Script main{catalog, 10};
    main.InsertTextAt(0, sql);

    // Dry run
    if (auto status = main.Analyze(); status != buffers::status::StatusCode::OK) {
        std::cerr << "dry run failed with status: " << buffers::status::EnumNameStatusCode(status) << std::endl;
    }
    for (auto _ : state) {
        main.Parse();
    }
}

static void analyze_query(benchmark::State& state) {
    Catalog catalog;

    Script schema{catalog, 2};
    schema.InsertTextAt(0, TPCH_SCHEMA);
    catalog.LoadScript(schema, 0);

    size_t cte_count = state.range(0);
    auto sql = generate_query(cte_count);

    Script main{catalog, 10};
    main.InsertTextAt(0, sql);

    // Dry run
    if (auto status = main.Analyze(); status != buffers::status::StatusCode::OK) {
        std::cerr << "dry run failed with status: " << buffers::status::EnumNameStatusCode(status) << std::endl;
    }
    for (auto _ : state) {
        main.Analyze(false);
    }
}

static void apply_cte_args(benchmark::internal::Benchmark* b) {
    for (int arg : {1, 5, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 500, 1000}) {
        b->Args({arg});
    }
}
BENCHMARK(scan_query)->Apply(apply_cte_args);
BENCHMARK(parse_query)->Apply(apply_cte_args);
BENCHMARK(analyze_query)->Apply(apply_cte_args);

int main(int argc, char** argv) {
    benchmark::Initialize(&argc, argv);
    benchmark::SetDefaultTimeUnit(benchmark::TimeUnit::kMillisecond);
    benchmark::RunSpecifiedBenchmarks();
}
