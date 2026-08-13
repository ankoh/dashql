#include "dashql/analyzer/completion.h"

#include <algorithm>

#include "dashql/catalog.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

TEST(CompletionTest, OperatorsAreNotCompletable) {
    using Symbol = parser::Parser::symbol_kind_type;
    for (auto symbol : {Symbol::S_EQUALS, Symbol::S_Op, Symbol::S_EQUALS_GREATER, Symbol::S_PIPE_GREATER,
                        Symbol::S_LESS_EQUALS, Symbol::S_GREATER_EQUALS, Symbol::S_NOT_EQUALS}) {
        EXPECT_FALSE(Completion::IsSymbolKindCompletable(symbol));
    }
    EXPECT_TRUE(Completion::IsSymbolKindCompletable(Symbol::S_IDENT));
}

const std::string_view TPCH_SCHEMA = R"SQL(
create table part (p_partkey integer not null, p_name varchar(55) not null, p_mfgr char(25) not null, p_brand char(10) not null, p_type varchar(25) not null, p_size integer not null, p_container char(10) not null, p_retailprice decimal(12,2) not null, p_comment varchar(23) not null, primary key (p_partkey));
create table supplier (s_suppkey integer not null, s_name char(25) not null, s_address varchar(40) not null, s_nationkey integer not null, s_phone char(15) not null, s_acctbal decimal(12,2) not null, s_comment varchar(101) not null, primary key (s_suppkey));
create table partsupp (ps_partkey integer not null, ps_suppkey integer not null, ps_availqty integer not null, ps_supplycost decimal(12,2) not null, ps_comment varchar(199) not null, primary key (ps_partkey,ps_suppkey));
create table customer (c_custkey integer not null, c_name varchar(25) not null, c_address varchar(40) not null, c_nationkey integer not null, c_phone char(15) not null, c_acctbal decimal(12,2) not null, c_mktsegment char(10) not null, c_comment varchar(117) not null, primary key (c_custkey));
create table orders (o_orderkey integer not null, o_custkey integer not null, o_orderstatus char(1) not null, o_totalprice decimal(12,2) not null, o_orderdate date not null, o_orderpriority char(15) not null, o_clerk char(15) not null, o_shippriority integer not null, o_comment varchar(79) not null, primary key (o_orderkey));
create table lineitem (l_orderkey integer not null, l_partkey integer not null, l_suppkey integer not null, l_linenumber integer not null, l_quantity decimal(12,2) not null, l_extendedprice decimal(12,2) not null, l_discount decimal(12,2) not null, l_tax decimal(12,2) not null, l_returnflag char(1) not null, l_linestatus char(1) not null, l_shipdate date not null, l_commitdate date not null, l_receiptdate date not null, l_shipinstruct char(25) not null, l_shipmode char(10) not null, l_comment varchar(44) not null, primary key (l_orderkey,l_linenumber));
create table nation (n_nationkey integer not null, n_name char(25) not null, n_regionkey integer not null, n_comment varchar(152) not null, primary key (n_nationkey));
create table region (r_regionkey integer not null, r_name char(25) not null, r_comment varchar(152) not null, primary key (r_regionkey));
)SQL";

TEST(CompletionTest, TPCH_Q2) {
    const std::string_view main_script_text = R"SQL(
SELECT s_co
    )SQL";

    Catalog catalog;
    Script external_script{catalog};
    external_script.InsertTextAt(0, TPCH_SCHEMA);
    ASSERT_NO_THROW({
        external_script.Scan();
        external_script.Parse();
        external_script.Analyze();
    });

    ASSERT_NO_THROW(catalog.LoadScript(external_script, 0));

    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Move the cursor
    auto cursor_ofs = main_script_text.find("s_co");
    ASSERT_EQ(cursor_ofs, 8);
    cursor_ofs += std::string_view{"s_co"}.size();
    main_script.MoveCursor(cursor_ofs);

    // Compute completion
    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    std::vector<std::string> names;
    for (auto& candidate : results) {
        std::string name{candidate.completion_text};
        if (!candidate.keyword_continuation.empty()) {
            name += " ";
            name += candidate.keyword_continuation;
        }
        names.emplace_back(std::move(name));
    }
    std::vector<std::string> expected_names{"s_co",      "s_comment", "ps_comment", "from", "where",
                                            "group by", "order by",  "by",         "case",  "cast"};
    ASSERT_EQ(names, expected_names);
}

TEST(CompletionTest, KeywordContinuation_GroupBy) {
    const std::string_view main_script_text = R"SQL(
SELECT * FROM supplier gro
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Position cursor at end of "gro"
    auto cursor_ofs = main_script_text.find("gro");
    cursor_ofs += std::string_view{"gro"}.size();
    main_script.MoveCursor(cursor_ofs);

    // Compute completion
    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // Find the "group" candidate and check its continuation
    bool found_group = false;
    for (auto& candidate : results) {
        if (candidate.completion_text == "group") {
            found_group = true;
            ASSERT_EQ(candidate.keyword_continuation, "by");
            break;
        }
    }
    ASSERT_TRUE(found_group) << "Expected 'group' candidate with continuation";
}

TEST(CompletionTest, KeywordContinuation_OrderBy) {
    const std::string_view main_script_text = R"SQL(
SELECT * FROM supplier ord
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    auto cursor_ofs = main_script_text.find("ord");
    cursor_ofs += std::string_view{"ord"}.size();
    main_script.MoveCursor(cursor_ofs);

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    bool found_order = false;
    for (auto& candidate : results) {
        if (candidate.completion_text == "order") {
            found_order = true;
            ASSERT_EQ(candidate.keyword_continuation, "by");
            break;
        }
    }
    ASSERT_TRUE(found_order) << "Expected 'order' candidate with continuation";
}

TEST(CompletionTest, KeywordContinuation_NoAmbiguous) {
    const std::string_view main_script_text = R"SQL(
SELECT sel
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    auto cursor_ofs = main_script_text.find("sel");
    cursor_ofs += std::string_view{"sel"}.size();
    main_script.MoveCursor(cursor_ofs);

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // "select" has many possible continuations, should NOT have a keyword_continuation
    for (auto& candidate : results) {
        if (candidate.completion_text == "select") {
            ASSERT_TRUE(candidate.keyword_continuation.empty())
                << "'select' should not have a continuation (ambiguous)";
            break;
        }
    }
}

TEST(CompletionTest, KeywordContinuation_CTEIdentifier) {
    const std::string_view main_script_text = R"SQL(
WITH fo
    )SQL";

    Catalog catalog;
    Script external_script{catalog};
    external_script.InsertTextAt(0, "create table foo(a int);");
    ASSERT_NO_THROW({
        external_script.Scan();
        external_script.Parse();
        external_script.Analyze();
    });
    ASSERT_NO_THROW(catalog.LoadScript(external_script, 0));

    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    auto cursor_ofs = main_script_text.find("fo");
    cursor_ofs += std::string_view{"fo"}.size();
    main_script.MoveCursor(cursor_ofs);

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // Identifier candidate "foo" in CTE position should get "as" continuation
    bool found_foo = false;
    for (auto& candidate : results) {
        if (candidate.completion_text == "foo") {
            found_foo = true;
            ASSERT_EQ(candidate.keyword_continuation, "as")
                << "'foo' should have 'as' continuation in CTE position";
            break;
        }
    }
    ASSERT_TRUE(found_foo) << "Expected 'foo' candidate with 'as' continuation";
}

TEST(CompletionTest, PassiveHint_SelectStar) {
    const std::string_view main_script_text = "select * ";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Cursor at end (after the space following *)
    main_script.MoveCursor(main_script_text.size());

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // Should suggest FROM as the top candidate (not WHERE)
    ASSERT_FALSE(results.empty());
    ASSERT_EQ(results[0].completion_text, "from");
}

TEST(CompletionTest, FunctionCallIsAtomic) {
    Catalog catalog;
    Script schema{catalog};
    schema.InsertTextAt(0, "create function mysum(x int) returns int;");
    schema.Analyze();
    catalog.LoadScript(schema, 0);

    Script script{catalog};
    script.InsertTextAt(0, "select mys");
    script.Analyze();
    script.MoveCursor(script.scanned_script->GetInput().size());

    auto completion = script.CompleteAtCursor(10);
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(completion->Pack(builder));
    auto* packed = flatbuffers::GetRoot<buffers::completion::Completion>(builder.GetBufferPointer());
    const buffers::completion::CompletionCandidate* candidate = nullptr;
    for (auto* value : *packed->candidates()) {
        if (value->display_text()->string_view() == "mysum") {
            candidate = value;
            break;
        }
    }
    ASSERT_NE(candidate, nullptr);
    EXPECT_EQ(candidate->completion_text()->string_view(), "mysum()");
    EXPECT_EQ(candidate->completion_cursor_offset(), std::string_view{"mysum("}.size());
}

TEST(CompletionTest, PassiveHint_SuppressAfterFrom) {
    const std::string_view main_script_text = "select * from ";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    main_script.MoveCursor(main_script_text.size());

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // Should produce no passive hint after FROM
    ASSERT_TRUE(results.empty());
}

TEST(CompletionTest, PassiveHint_SuppressAfterWhere) {
    const std::string_view main_script_text = "select * from foo where ";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    main_script.MoveCursor(main_script_text.size());

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // Should produce no passive hint after WHERE
    ASSERT_TRUE(results.empty());
}

TEST(CompletionTest, PassiveHint_AfterFromTable) {
    const std::string_view main_script_text = "select * from foo ";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    main_script.MoveCursor(main_script_text.size());

    auto completion = main_script.CompleteAtCursor();
    auto& results = completion->GetResultCandidates();

    // After a table name, should suggest WHERE (not suppressed)
    ASSERT_FALSE(results.empty());
    ASSERT_EQ(results[0].completion_text, "where");
}

TEST(CompletionTest, InlineVisualizeSourceOutputAlias) {
    const std::string_view text = R"SQL(
SELECT category AS chart_category, SUM(amount) AS chart_total
FROM sales
GROUP BY category
|> VISUALIZE USING vegalite (
    encoding => (y => (field => chart_t, type => quantitative))
)
)SQL";

    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, text);
    ASSERT_NO_THROW(script.Analyze());

    script.MoveCursor(text.rfind("chart_t") + std::string_view{"chart_t"}.size());
    auto completion = script.CompleteAtCursor();

    bool found = false;
    for (auto& candidate : completion->GetResultCandidates()) {
        if (candidate.completion_text != "chart_total") continue;
        found = true;
        EXPECT_TRUE(candidate.coarse_name_tags.contains(buffers::analyzer::NameTag::COLUMN_NAME));
        EXPECT_TRUE(candidate.candidate_tags.contains(buffers::completion::CandidateTag::IN_NAME_SCOPE));
        EXPECT_GT(candidate.score, 59u);
    }
    EXPECT_TRUE(found);
}

TEST(CompletionTest, PipeVisualizeSourceOutputAlias) {
    const std::string_view text = R"SQL(
FROM sales
|> SELECT category AS chart_category, amount AS chart_total
|> VISUALIZE USING vegalite (
    encoding => (y => (field => chart_t, type => quantitative))
)
)SQL";

    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, text);
    ASSERT_NO_THROW(script.Analyze());

    script.MoveCursor(text.rfind("chart_t") + std::string_view{"chart_t"}.size());
    auto completion = script.CompleteAtCursor();

    auto found = std::find_if(completion->GetResultCandidates().begin(), completion->GetResultCandidates().end(),
                              [](const auto& candidate) { return candidate.completion_text == "chart_total"; });
    ASSERT_NE(found, completion->GetResultCandidates().end());
    EXPECT_TRUE(found->candidate_tags.contains(buffers::completion::CandidateTag::IN_NAME_SCOPE));
}

TEST(CompletionTest, NoCompletionInsideLineComment) {
    const std::string_view main_script_text = R"SQL(
SELECT 1 -- sel
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Cursor at the end of "sel" inside the line comment.
    auto cursor_ofs = main_script_text.find("sel") + std::string_view{"sel"}.size();
    main_script.MoveCursor(cursor_ofs);

    auto completion = main_script.CompleteAtCursor();
    ASSERT_TRUE(completion->GetResultCandidates().empty())
        << "Expected no completion inside a line comment, got " << completion->GetResultCandidates().size();
}

TEST(CompletionTest, NoCompletionInsideBlockComment) {
    const std::string_view main_script_text = R"SQL(
SELECT 1 /* sel */ FROM x
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Cursor at the end of "sel" inside the block comment.
    auto cursor_ofs = main_script_text.find("sel") + std::string_view{"sel"}.size();
    main_script.MoveCursor(cursor_ofs);

    auto completion = main_script.CompleteAtCursor();
    ASSERT_TRUE(completion->GetResultCandidates().empty())
        << "Expected no completion inside a block comment, got " << completion->GetResultCandidates().size();
}

TEST(CompletionTest, CompletionRightBeforeComment) {
    const std::string_view main_script_text = R"SQL(
SELECT * FROM supplier gro-- comment
    )SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW({
        main_script.Scan();
        main_script.Parse();
        main_script.Analyze();
    });

    // Cursor at the end of "gro", immediately before the `--` comment start.
    auto cursor_ofs = main_script_text.find("gro") + std::string_view{"gro"}.size();
    main_script.MoveCursor(cursor_ofs);

    // The comment right after the cursor must not suppress completion: "group" is still offered.
    auto completion = main_script.CompleteAtCursor();
    bool found_group = false;
    for (auto& candidate : completion->GetResultCandidates()) {
        if (candidate.completion_text == "group") {
            found_group = true;
            break;
        }
    }
    ASSERT_TRUE(found_group) << "Expected completion right before a comment";
}

TEST(CompletionTest, IdentityCandidateReproducesQuotedInputVerbatim) {
    // A delimited identifier in a projection whose schema is unknown (e.g. an external() table)
    // has no matching catalog name, so the identity candidate is what the user accepts. It must
    // reproduce the typed text verbatim, so completing it is a no-op instead of a visible
    // delete-and-reinsert. Two failure modes we guard against:
    //   - `"Year"` re-quoted a second time by Pack() -> `"""Year"""`
    //   - `"year"` re-emitted unquoted -> `year` (dropping the quotes the user typed)
    for (std::string_view typed : {std::string_view{"\"Year\""}, std::string_view{"\"year\""}}) {
        std::string main_script_text = "SELECT ";
        main_script_text += typed;

        Catalog catalog;
        Script main_script{catalog};
        main_script.InsertTextAt(0, main_script_text);
        ASSERT_NO_THROW({
            main_script.Scan();
            main_script.Parse();
            main_script.Analyze();
        });

        // Cursor just before the closing quote of the delimited identifier.
        main_script.MoveCursor(main_script_text.size() - 1);

        auto completion = main_script.CompleteAtCursor();
        auto& results = completion->GetResultCandidates();

        bool found_identity = false;
        for (auto& candidate : results) {
            if (candidate.candidate_tags.contains(buffers::completion::CandidateTag::IDENTITY)) {
                found_identity = true;
                // The identity candidate must equal the typed text, quotes and all.
                ASSERT_EQ(candidate.completion_text, typed)
                    << "Identity candidate must reproduce the typed text verbatim";
            }
        }
        ASSERT_TRUE(found_identity) << "Expected an identity candidate for " << typed;
    }
}

TEST(CompletionTest, CompletesInsertedCteNameBeforeLongSuffix) {
    constexpr std::string_view main_script_text = R"SQL(with  as (
    select
      *,
      date_trunc('hour', event_timestamp) ts_hour
    from uip_iceberg.cdp_usage_prod_events.hyperdb_queries
    where tenant = 'a360/prod/1e51a99248ee43beb982c09ea3ed8786'
    and event_timestamp >= current_timestamp - interval '30' day
), windowed as (
  select
    *,
    ts_hour,
    row_number() over (partition by tenant order by processed_rows desc) as rnk_processed_rows
  from d
)
select *
from windowed
where rnk_processed_rows < 10
)SQL";

    Catalog catalog;
    Script main_script{catalog};
    main_script.InsertTextAt(0, main_script_text);
    ASSERT_NO_THROW(main_script.Analyze());

    constexpr size_t cursor_offset = std::string_view{"with "}.size();
    main_script.MoveCursor(cursor_offset);
    main_script.InsertTextAt(cursor_offset, "q");
    ASSERT_NO_THROW(main_script.Analyze());
    main_script.MoveCursor(cursor_offset + 1);
    ASSERT_NO_THROW(main_script.CompleteAtCursor());
}

}  // namespace
