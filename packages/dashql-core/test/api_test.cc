#include "dashql/api.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

constexpr auto OK = static_cast<uint32_t>(buffers::status::StatusCode::OK);

std::pair<std::string_view, std::unique_ptr<char[]>> copyText(std::string_view text) {
    auto buffer = std::unique_ptr<char[]>(new char[text.size()]);
    memcpy(buffer.get(), text.data(), text.size());
    std::string_view buffer_text{buffer.get(), text.size()};
    return {buffer_text, std::move(buffer)};
}

TEST(ApiTest, TPCH_Q2) {
    const std::string_view external_script_text = R"SQL(
create table part (p_partkey integer not null, p_name varchar(55) not null, p_mfgr char(25) not null, p_brand char(10) not null, p_type varchar(25) not null, p_size integer not null, p_container char(10) not null, p_retailprice decimal(12,2) not null, p_comment varchar(23) not null, primary key (p_partkey));
create table supplier (s_suppkey integer not null, s_name char(25) not null, s_address varchar(40) not null, s_nationkey integer not null, s_phone char(15) not null, s_acctbal decimal(12,2) not null, s_comment varchar(101) not null, primary key (s_suppkey));
create table partsupp (ps_partkey integer not null, ps_suppkey integer not null, ps_availqty integer not null, ps_supplycost decimal(12,2) not null, ps_comment varchar(199) not null, primary key (ps_partkey,ps_suppkey));
create table customer (c_custkey integer not null, c_name varchar(25) not null, c_address varchar(40) not null, c_nationkey integer not null, c_phone char(15) not null, c_acctbal decimal(12,2) not null, c_mktsegment char(10) not null, c_comment varchar(117) not null, primary key (c_custkey));
create table orders (o_orderkey integer not null, o_custkey integer not null, o_orderstatus char(1) not null, o_totalprice decimal(12,2) not null, o_orderdate date not null, o_orderpriority char(15) not null, o_clerk char(15) not null, o_shippriority integer not null, o_comment varchar(79) not null, primary key (o_orderkey));
create table lineitem (l_orderkey integer not null, l_partkey integer not null, l_suppkey integer not null, l_linenumber integer not null, l_quantity decimal(12,2) not null, l_extendedprice decimal(12,2) not null, l_discount decimal(12,2) not null, l_tax decimal(12,2) not null, l_returnflag char(1) not null, l_linestatus char(1) not null, l_shipdate date not null, l_commitdate date not null, l_receiptdate date not null, l_shipinstruct char(25) not null, l_shipmode char(10) not null, l_comment varchar(44) not null, primary key (l_orderkey,l_linenumber));
create table nation (n_nationkey integer not null, n_name char(25) not null, n_regionkey integer not null, n_comment varchar(152) not null, primary key (n_nationkey));
create table region (r_regionkey integer not null, r_name char(25) not null, r_comment varchar(152) not null, primary key (r_regionkey));
    )SQL";

    [[maybe_unused]] const std::string_view main_script_text = R"SQL(
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
    part,
    supplier,
    partsupp,
    nation,
    region
where
    p_partkey = ps_partkey
    and s_suppkey = ps_suppkey
    and p_size = 15
    and p_type like '%BRASS'
    and s_nationkey = n_nationkey
    and n_regionkey = r_regionkey
    and r_name = 'EUROPE'
    and ps_supplycost = (
        select
            min(ps_supplycost)
        from
            partsupp,
            supplier,
            nation,
            region
        where
            p_partkey = ps_partkey
            and s_suppkey = ps_suppkey
            and s_nationkey = n_nationkey
            and n_regionkey = r_regionkey
            and r_name = 'EUROPE'
    )
order by
    s_acctbal desc,
    n_name,
    s_name,
    p_partkey
limit 100
    )SQL";

    // Create a new catalog
    FFIResult catalog_result;
    dashql_catalog_new(&catalog_result);
    auto catalog = reinterpret_cast<Catalog*>(catalog_result.owner_ptr);

    FFIResult external_script_result;
    dashql_script_new(&external_script_result, catalog);
    auto external_script = reinterpret_cast<Script*>(external_script_result.owner_ptr);
    auto [external_text, external_text_buffer] = copyText(external_script_text);
    dashql_script_insert_text_at(external_script, 0, external_text_buffer.release(), external_text.size());

    ASSERT_NO_THROW(dashql_script_scan(external_script));
    ASSERT_NO_THROW(dashql_script_parse(external_script));
    ASSERT_NO_THROW(dashql_script_analyze(external_script, false));

    ASSERT_NO_THROW(dashql_catalog_load_script(catalog, external_script, 0));

    FFIResult main_script_result;
    dashql_script_new(&main_script_result, catalog);
    auto main_script = reinterpret_cast<Script*>(main_script_result.owner_ptr);
    auto [main_text, main_text_buffer] = copyText(external_script_text);
    dashql_script_insert_text_at(main_script, 0, main_text_buffer.release(), main_text.size());

    ASSERT_NO_THROW(dashql_script_scan(main_script));
    ASSERT_NO_THROW(dashql_script_parse(main_script));
    ASSERT_NO_THROW(dashql_script_analyze(main_script, false));

    dashql_delete_owner(main_script_result.owner_ptr, main_script_result.owner_deleter);
    dashql_delete_owner(external_script_result.owner_ptr, external_script_result.owner_deleter);
    dashql_delete_owner(catalog_result.owner_ptr, catalog_result.owner_deleter);
}

}  // namespace
