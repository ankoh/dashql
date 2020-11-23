// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/program_diff.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
using SimilarityEstimate = ProgramMatcher::SimilarityEstimate;
namespace fb = flatbuffers;

namespace {

class ProgramMatcherProxy: public ProgramMatcher {
    public:
    /// Constructor
    ProgramMatcherProxy(std::string_view source_text, std::string_view target_text, const sx::Program& source_program, const sx::Program& target_program)
        : ProgramMatcher(source_text, target_text, source_program, target_program) {}

    using ProgramMatcher::MapStatements;
    using ProgramMatcher::FindLCS;
};

std::pair<const sx::Program*, fb::DetachedBuffer> Parse(std::string_view text) {
    fb::FlatBufferBuilder builder;
    auto ofs = parser::ParserDriver::Parse(builder, text);
    builder.Finish(ofs);
    auto buffer = builder.Release();
    auto program = fb::GetRoot<sx::Program>(buffer.data());
    return {program, move(buffer)};
}

struct SSP {
    std::string_view t1;
    std::string_view t2;
    bool are_equal;
    SimilarityEstimate estimate;
    std::optional<size_t> diff_node_count = std::nullopt;

    friend std::ostream& operator<<(std::ostream& out, const SSP& param) {
        out << param.t1 << " " << param.t2;
        return out;
    }
};
class SingleStatementTest: public ::testing::TestWithParam<SSP> {};

TEST_P(SingleStatementTest, DeepEquality) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
    ASSERT_EQ(matcher.CheckDeepEquality(*s1, *s2), param.are_equal);
}

TEST_P(SingleStatementTest, SimilarityEstimate) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
    ASSERT_EQ(matcher.EstimateSimilarity(*s1, *s2), param.estimate);
}

TEST_P(SingleStatementTest, StatementDiff) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
    auto diff = matcher.ComputeDiff(*s1, *s2);
    ASSERT_EQ(diff.Equal(), param.are_equal);
    if (param.diff_node_count)
        ASSERT_EQ(diff.diff_nodes.size(), *param.diff_node_count);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, SingleStatementTest, ::testing::Values(
    SSP{"SELECT 1", "SELECT 1", true, SimilarityEstimate::EQUAL, 0},
    SSP{"SELECT 1", "SELECT 2", false, SimilarityEstimate::SIMILAR, 1},
    SSP{"select c from b where c = global.a",
        "select c from b where c = global.a",
        true, SimilarityEstimate::EQUAL, 0},
    SSP{"select c from b where c = global.a",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR, 1},
    SSP{"select 1",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR},
    SSP{"viz whether_avg using line",
        "select c from b where c = global.d",
        false, SimilarityEstimate::NOT_EQUAL}
));

struct UPP {
    std::string_view t1;
    std::string_view t2;
    std::vector<size_t> ids0;
    std::vector<size_t> ids1;
    std::vector<std::pair<size_t, size_t>> unique;
    std::vector<std::pair<size_t, size_t>> equal;
    std::vector<std::pair<size_t, size_t>> lcs;

    friend std::ostream& operator<<(std::ostream& out, const UPP& param) {
        out << param.t1 << " " << param.t2;
        return out;
    }
};
class StatementMappingTest: public ::testing::TestWithParam<UPP> {};

TEST_P(StatementMappingTest, StatementMappingsEqual) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    std::vector<std::pair<size_t, size_t>> unique_pairs;
    std::vector<std::pair<size_t, size_t>> equal_pairs;
    matcher.MapStatements(param.ids0, param.ids1, unique_pairs, equal_pairs);
    ASSERT_EQ(unique_pairs, param.unique);
    std::sort(equal_pairs.begin(), equal_pairs.end(), [&](auto& l, auto& r) {
        return l.first < r.first;
    });
    ASSERT_EQ(equal_pairs, param.equal);
}

TEST_P(StatementMappingTest, LCSEquals) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    std::vector<std::pair<size_t, size_t>> unique_pairs;
    std::vector<std::pair<size_t, size_t>> equal_pairs;
    matcher.MapStatements(param.ids0, param.ids1, unique_pairs, equal_pairs);
    std::vector<std::pair<size_t, size_t>> lcs;
    matcher.FindLCS(unique_pairs, lcs);
    ASSERT_EQ(lcs, param.lcs);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, StatementMappingTest, ::testing::Values(
    UPP{R"DQL(
        SELECT 1;
    )DQL", R"DQL(
        SELECT 1;
    )DQL", {0}, {0}, {{0, 0}}, {{0, 0}}, {{0, 0}}},

    UPP{R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 1;
    )DQL", {0, 1}, {0}, {{1, 0}}, {{1, 0}}, {{1, 0}}},

    UPP{R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {{1, 1}}, {{1, 1}}, {{1, 1}}},

    UPP{R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {}, {}, {}},

    UPP{R"DQL(
        SELECT 1;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {}, {{0, 1}, {1, 1}}, {}},

    UPP{R"DQL(
        SELECT 1;
        SELECT 2;
    )DQL", R"DQL(
        SELECT 1;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {}, {{0, 0}, {0, 1}}, {}},

    UPP{R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 1;
        SELECT 2;
    )DQL", {0, 1}, {0, 1}, {{0, 1}, {1, 0}}, {{0, 1}, {1, 0}}, {{1, 0}}}
));

}  // namespace
