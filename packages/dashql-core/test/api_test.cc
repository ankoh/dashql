#include "dashql/api.h"

#include "dashql/async_analysis.h"
#include "dashql/catalog.h"
#include "dashql/exception.h"
#include "dashql/script_session.h"
#include "gtest/gtest.h"

#include <chrono>
#include <thread>

using namespace dashql;

namespace {

using namespace std::chrono_literals;

uint32_t WaitForJob(uint32_t job_id) {
    for (size_t i = 0; i < 10'000; ++i) {
        auto state = AsyncAnalysisJobs::Poll(job_id);
        if (state >= AsyncAnalysisJobState::READY) return static_cast<uint32_t>(state);
        std::this_thread::sleep_for(1ms);
    }
    return static_cast<uint32_t>(AsyncAnalysisJobs::Poll(job_id));
}

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

TEST(ApiTest, GetStatementTextExcludesSeparatorAndTrivia) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, "  SELECT ';' AS value ; -- trailing comment\n");

    EXPECT_EQ(script.GetStatementText(), "SELECT ';' AS value");
}

TEST(ApiTest, LoadScriptsUsesCompactPointerAndRankArrays) {
    Catalog catalog;
    Script relations{catalog};
    Script functions{catalog};
    relations.InsertTextAt(0, "create table db.schema.items(id int);");
    functions.InsertTextAt(0, "create function db.schema.item_count() returns int;");
    relations.Analyze();
    functions.Analyze();
    Script* scripts[] = {&relations, &functions};
    const uint32_t ranks[] = {7, 3};
    auto previous_version = catalog.GetVersion();

    ASSERT_NO_THROW(dashql_catalog_load_scripts(&catalog, scripts, ranks, 2));
    EXPECT_EQ(catalog.GetVersion(), previous_version + 1);
    EXPECT_TRUE(catalog.Contains(relations.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(functions.GetCatalogEntryId()));
}

TEST(ApiTest, AsyncAnalysisRunsTwoJobsAndPublishesResults) {
    Catalog catalog;
    Script first{catalog};
    Script second{catalog};
    first.InsertTextAt(0, "select 1");
    second.InsertTextAt(0, "select 2");

    auto first_job = dashql_script_analyze_async(&first, true);
    auto second_job = dashql_script_analyze_async(&second, true);
    EXPECT_EQ(WaitForJob(first_job), static_cast<uint32_t>(AsyncAnalysisJobState::READY));
    EXPECT_EQ(WaitForJob(second_job), static_cast<uint32_t>(AsyncAnalysisJobState::READY));
    EXPECT_NE(first.GetAnalyzedScript(), nullptr);
    EXPECT_NE(second.GetAnalyzedScript(), nullptr);
    dashql_script_analysis_job_release(first_job);
    dashql_script_analysis_job_release(second_job);
}

TEST(ApiTest, AsyncAnalysisRejectsDuplicateAndBusyOperations) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, "select 1");
    auto job = dashql_script_analyze_async(&script, true);

    EXPECT_THROW(dashql_script_analyze_async(&script, true), Exception);
    auto state = AsyncAnalysisJobs::Poll(job);
    if (state < AsyncAnalysisJobState::READY) {
        EXPECT_THROW(script.ToString(), Exception);
    }
    EXPECT_EQ(WaitForJob(job), static_cast<uint32_t>(AsyncAnalysisJobState::READY));
    EXPECT_EQ(script.ToString(), "select 1");
    dashql_script_analysis_job_release(job);
    EXPECT_EQ(script.ToString(), "select 1");
}

TEST(ApiTest, AsyncAnalysisContainsWorkerExceptions) {
    Catalog catalog;
    Script invalid{catalog};
    auto failed = dashql_script_analyze_async(&invalid, false);
    EXPECT_EQ(WaitForJob(failed), static_cast<uint32_t>(AsyncAnalysisJobState::FAILED));
    EXPECT_EQ(invalid.ToString(), "");
    EXPECT_EQ(dashql_script_analysis_job_get_error_code(failed),
              static_cast<uint32_t>(buffers::status::StatusCode::SCRIPT_NOT_PARSED));
    FFIResult message;
    dashql_script_analysis_job_get_error_message(&message, failed);
    EXPECT_EQ(std::string_view(static_cast<const char*>(message.data_ptr), message.data_length), "Script is not parsed");
    dashql_delete_owner(message.owner_ptr, message.owner_deleter);
    dashql_script_analysis_job_release(failed);

    Script valid{catalog};
    valid.InsertTextAt(0, "select 1");
    auto ready = dashql_script_analyze_async(&valid, true);
    EXPECT_EQ(WaitForJob(ready), static_cast<uint32_t>(AsyncAnalysisJobState::READY));
    dashql_script_analysis_job_release(ready);
}

TEST(ApiTest, FailedAsyncCatalogAnalysisDoesNotBlockScriptSessions) {
    Catalog catalog;
    Script invalid{catalog};
    auto failed = dashql_script_analyze_async(&invalid, false);
    EXPECT_EQ(WaitForJob(failed), static_cast<uint32_t>(AsyncAnalysisJobState::FAILED));

    ScriptSession session{catalog, buffers::editor::EditorOffsetUnit::UTF16_CODE_UNITS};
    auto replaced = session.ReplaceText(0, "select 1");
    EXPECT_EQ(replaced.status, buffers::editor::EditorUpdateStatus::OK);
    auto analyzed = session.EnsureSynchronousAnalysis();
    EXPECT_EQ(analyzed.status, buffers::editor::EditorUpdateStatus::OK);
    EXPECT_TRUE(analyzed.analysis_available);

    dashql_script_analysis_job_release(failed);
}

TEST(ApiTest, AsyncAnalysisCancellationPublishesCancelledState) {
    Catalog catalog;
    Script script{catalog};
    std::string query = "select ";
    for (size_t i = 0; i < 20'000; ++i) query += i == 0 ? "1" : "+1";
    script.InsertTextAt(0, query);
    auto job = dashql_script_analyze_async(&script, true);
    EXPECT_TRUE(dashql_script_analysis_job_cancel(job));
    EXPECT_EQ(WaitForJob(job), static_cast<uint32_t>(AsyncAnalysisJobState::CANCELLED));
    dashql_script_analysis_job_release(job);
}

}  // namespace
