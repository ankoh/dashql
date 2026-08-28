#include "dashql/catalog.h"

#include <flatbuffers/buffer.h>
#include <flatbuffers/flatbuffer_builder.h>

#include <atomic>
#include <chrono>
#include <future>
#include <shared_mutex>
#include <string>
#include <vector>

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_object.h"
#include "dashql/exception.h"
#include "dashql/script.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

class LockInspectableCatalog : public Catalog {
   public:
    bool TryLockStateExclusive() {
        if (!state_mutex.try_lock()) {
            return false;
        }
        state_mutex.unlock();
        return true;
    }
};

TEST(CatalogTest, FlattenEmpty) {
    Catalog catalog;
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
}

constexpr std::string_view TPCH_SCHEMA = R"SQL(
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

create table region (
   r_regionkey integer not null,
   r_name char(25) not null,
   r_comment varchar(152) not null,
   primary key (r_regionkey)
);
)SQL";

TEST(CatalogTest, FlattenExampleSchema) {
    Catalog catalog;

    // Create script with TPCH schema
    Script script{catalog};
    script.InsertTextAt(0, TPCH_SCHEMA);
    ASSERT_NO_THROW({
        script.Scan();
        script.Parse();
        script.Analyze();
    });
    auto& analyzed = script.GetAnalyzedScript();

    // Make sure the analyzed script matches expectations
    ASSERT_EQ(analyzed->GetDatabasesByName().size(), 1);
    ASSERT_EQ(analyzed->GetSchemasByName().size(), 1);
    ASSERT_EQ(analyzed->GetTablesByName().size(), 8);

    // Add to catalog
    ASSERT_NO_THROW(catalog.LoadScript(script, 1));

    // Flatten the catalog
    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(catalog.Flatten(fb));
    auto flat = flatbuffers::GetRoot<buffers::catalog::FlatCatalog>(fb.GetBufferPointer());

    // Test the catalog
    ASSERT_EQ(flat->catalog_version(), catalog.GetVersion());
    ASSERT_EQ(flat->databases()->size(), 1);
    ASSERT_EQ(flat->schemas()->size(), 1);
}

TEST(CatalogTest, LoadScriptsPublishesOneRankedGeneration) {
    Catalog catalog;
    Script relations{catalog};
    Script functions{catalog};
    relations.InsertTextAt(0, "create table db.schema.items(id int);");
    functions.InsertTextAt(0, "create function db.schema.item_count() returns int;");
    relations.Analyze();
    functions.Analyze();
    auto previous_version = catalog.GetVersion();

    const Catalog::ScriptBatchEntry batch[] = {{&relations, 20}, {&functions, 10}};
    ASSERT_NO_THROW(catalog.LoadScripts(batch));

    EXPECT_EQ(catalog.GetVersion(), previous_version + 1);
    EXPECT_TRUE(catalog.Contains(relations.GetCatalogEntryId()));
    EXPECT_TRUE(catalog.Contains(functions.GetCatalogEntryId()));
    std::vector<std::tuple<CatalogEntryID, CatalogEntry::Rank, size_t, size_t>> entries;
    catalog.IterateRanked([&](auto id, auto& entry, auto rank) {
        entries.emplace_back(id, rank, entry.GetTables().GetSize(), entry.GetFunctions().GetSize());
    });
    ASSERT_EQ(entries.size(), 2);
    EXPECT_EQ(entries[0], std::make_tuple(functions.GetCatalogEntryId(), 10, 0, 1));
    EXPECT_EQ(entries[1], std::make_tuple(relations.GetCatalogEntryId(), 20, 1, 0));
}

TEST(CatalogTest, LoadScriptsUpdatesLoadedScriptsAndRanksOnce) {
    Catalog catalog;
    Script first{catalog};
    Script second{catalog};
    first.InsertTextAt(0, "create table db.schema.old_table(id int);");
    second.InsertTextAt(0, "create table db.schema.second_table(id int);");
    first.Analyze();
    second.Analyze();
    catalog.LoadScript(first, 1);
    catalog.LoadScript(second, 2);

    first.ReplaceText("create table db.schema.new_table(id int);");
    first.Analyze();
    auto previous_version = catalog.GetVersion();
    const Catalog::ScriptBatchEntry batch[] = {{&first, 30}, {&second, 20}};
    catalog.LoadScripts(batch);

    EXPECT_EQ(catalog.GetVersion(), previous_version + 1);
    std::vector<std::pair<CatalogEntryID, CatalogEntry::Rank>> ranked;
    catalog.IterateRanked([&](auto id, auto&, auto rank) { ranked.emplace_back(id, rank); });
    EXPECT_EQ(ranked, (std::vector<std::pair<CatalogEntryID, CatalogEntry::Rank>>{
                          {second.GetCatalogEntryId(), 20}, {first.GetCatalogEntryId(), 30}}));
    bool found_new_table = false;
    catalog.Iterate([&](auto id, auto& entry) {
        if (id == first.GetCatalogEntryId()) {
            ASSERT_EQ(entry.GetTables().GetSize(), 1);
            found_new_table = entry.GetTables()[0].table_name.table_name.get().text == "new_table";
        }
    });
    EXPECT_TRUE(found_new_table);
}

TEST(CatalogTest, LoadScriptsValidationFailurePreservesCatalog) {
    Catalog catalog;
    Catalog other_catalog;
    Script loaded{catalog};
    Script valid{catalog};
    Script unanalyzed{catalog};
    Script mismatched{other_catalog};
    loaded.InsertTextAt(0, "create table db.schema.loaded(id int);");
    valid.InsertTextAt(0, "create table db.schema.valid(id int);");
    mismatched.InsertTextAt(0, "create table db.schema.other(id int);");
    loaded.Analyze();
    valid.Analyze();
    mismatched.Analyze();
    catalog.LoadScript(loaded, 1);
    auto previous_version = catalog.GetVersion();

    const Catalog::ScriptBatchEntry unanalyzed_batch[] = {{&valid, 2}, {&unanalyzed, 3}};
    EXPECT_THROW(catalog.LoadScripts(unanalyzed_batch), Exception);
    EXPECT_EQ(catalog.GetVersion(), previous_version);
    EXPECT_TRUE(catalog.Contains(loaded.GetCatalogEntryId()));
    EXPECT_FALSE(catalog.Contains(valid.GetCatalogEntryId()));

    const Catalog::ScriptBatchEntry duplicate_batch[] = {{&valid, 2}, {&valid, 3}};
    EXPECT_THROW(catalog.LoadScripts(duplicate_batch), Exception);
    EXPECT_EQ(catalog.GetVersion(), previous_version);
    EXPECT_FALSE(catalog.Contains(valid.GetCatalogEntryId()));

    const Catalog::ScriptBatchEntry mismatch_batch[] = {{&valid, 2}, {&mismatched, 3}};
    EXPECT_THROW(catalog.LoadScripts(mismatch_batch), Exception);
    EXPECT_EQ(catalog.GetVersion(), previous_version);
    EXPECT_FALSE(catalog.Contains(valid.GetCatalogEntryId()));
}

TEST(CatalogTest, WriterWaitsForActiveAnalysis) {
    using namespace std::chrono_literals;

    LockInspectableCatalog catalog;
    Script script{catalog};
    std::string declarations;
    declarations.reserve(250'000);
    for (size_t i = 0; i < 5'000; ++i) {
        declarations += "create table db.schema.table_" + std::to_string(i) + "(a int);";
    }
    script.InsertTextAt(0, declarations);

    std::atomic<bool> analysis_finished = false;
    auto analysis = std::async(std::launch::async, [&] {
        script.Analyze();
        analysis_finished.store(true, std::memory_order_release);
    });

    bool observed_active_analysis = false;
    while (!analysis_finished.load(std::memory_order_acquire)) {
        if (!catalog.TryLockStateExclusive()) {
            observed_active_analysis = true;
            break;
        }
        std::this_thread::yield();
    }
    ASSERT_TRUE(observed_active_analysis);

    auto writer = std::async(std::launch::async, [&] { catalog.Clear(); });
    EXPECT_EQ(writer.wait_for(1ms), std::future_status::timeout);
    analysis.get();
    EXPECT_EQ(writer.wait_for(5s), std::future_status::ready);
    writer.get();
}

}  // namespace
