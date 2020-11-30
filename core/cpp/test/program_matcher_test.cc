// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/program_instance.h"
#include "dashql/program_matcher.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
using DiffOp = ProgramMatcher::DiffOp;
using SimilarityEstimate = ProgramMatcher::SimilarityEstimate;
using StatementMappings = ProgramMatcher::StatementMappings;
namespace fb = flatbuffers;

namespace {

class ProgramMatcherProxy: public ProgramMatcher {
    public:
    /// Constructor
    ProgramMatcherProxy(const ProgramInstance& source, const ProgramInstance& target)
        : ProgramMatcher(source, target) {}

    using ProgramMatcher::MapStatements;
    using ProgramMatcher::FindLCS;
};

struct SimilarityTest {
    std::string_view t1;
    std::string_view t2;
    bool are_equal;
    SimilarityEstimate estimate;
    std::optional<size_t> diff_node_count = std::nullopt;

    friend std::ostream& operator<<(std::ostream& out, const SimilarityTest& param) {
        out << param.t1 << " | " << param.t2;
        return out;
    }
};
class SimilarityTestSuite: public ::testing::TestWithParam<SimilarityTest> {};

TEST_P(SimilarityTestSuite, DeepEquality) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ASSERT_EQ(p1->statements.size(), 1);
    ASSERT_EQ(p2->statements.size(), 1);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    auto& s1 = pi1.program().statements[0], &s2 = pi2.program().statements[0];
    ASSERT_EQ(matcher.CheckDeepEquality(*s1, *s2), param.are_equal);
}

TEST_P(SimilarityTestSuite, SimilarityEstimate) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ASSERT_EQ(p1->statements.size(), 1);
    ASSERT_EQ(p2->statements.size(), 1);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    auto& s1 = pi1.program().statements[0], &s2 = pi2.program().statements[0];
    ASSERT_EQ(matcher.EstimateSimilarity(*s1, *s2), param.estimate);
}

TEST_P(SimilarityTestSuite, Similarity) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ASSERT_EQ(p1->statements.size(), 1);
    ASSERT_EQ(p2->statements.size(), 1);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    auto& s1 = pi1.program().statements[0], &s2 = pi2.program().statements[0];
    auto sim = matcher.ComputeSimilarity(*s1, *s2);
    ASSERT_EQ(sim.Equal(), param.are_equal);
    if (param.diff_node_count)
        ASSERT_EQ(sim.total_nodes - sim.matching_nodes, *param.diff_node_count);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, SimilarityTestSuite, ::testing::Values(
    SimilarityTest{"SELECT 1", "SELECT 1", true, SimilarityEstimate::EQUAL, 0},
    SimilarityTest{"SELECT 1", "SELECT 2", false, SimilarityEstimate::SIMILAR, 1},
    SimilarityTest{"select c from b where c = global.a",
        "select c from b where c = global.a",
        true, SimilarityEstimate::EQUAL, 0},
    SimilarityTest{"select c from b where c = global.a",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR, 1},
    SimilarityTest{"select 1",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR},
    SimilarityTest{"viz whether_avg using line",
        "select c from b where c = global.d",
        false, SimilarityEstimate::NOT_EQUAL}
));

struct MappingTest {
    std::string_view t1;
    std::string_view t2;
    std::vector<std::pair<size_t, size_t>> unique;
    std::vector<std::pair<size_t, size_t>> equal;
    std::vector<std::pair<size_t, size_t>> lcs;

    friend std::ostream& operator<<(std::ostream& out, const MappingTest& param) {
        out << param.t1 << " | " << param.t2;
        return out;
    }
};
class MappingTestSuite: public ::testing::TestWithParam<MappingTest> {};

TEST_P(MappingTestSuite, Mappings) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    StatementMappings unique_pairs;
    StatementMappings equal_pairs;
    matcher.MapStatements(unique_pairs, equal_pairs);
    ASSERT_EQ(unique_pairs, param.unique);
    std::sort(equal_pairs.begin(), equal_pairs.end(), [&](auto& l, auto& r) {
        return l.first < r.first;
    });
    ASSERT_EQ(equal_pairs, param.equal);
}

TEST_P(MappingTestSuite, LCS) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    StatementMappings unique_pairs;
    StatementMappings equal_pairs;
    matcher.MapStatements(unique_pairs, equal_pairs);
    auto lcs = matcher.FindLCS(unique_pairs);
    ASSERT_EQ(lcs, param.lcs);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, MappingTestSuite, ::testing::Values(
    MappingTest{"SELECT 1;", "SELECT 1;", {{0, 0}}, {{0, 0}}, {{0, 0}}},
    MappingTest{"SELECT 2; SELECT 1;", "SELECT 1;", {{1, 0}}, {{1, 0}}, {{1, 0}}},
    MappingTest{"SELECT 2; SELECT 1;", "SELECT 3; SELECT 1;", {{1, 1}}, {{1, 1}}, {{1, 1}}},
    MappingTest{"SELECT 1; SELECT 1;", "SELECT 3; SELECT 1;", {}, {{0, 1}, {1, 1}}, {}},
    MappingTest{"SELECT 1; SELECT 2;", "SELECT 1; SELECT 1;", {}, {{0, 0}, {0, 1}}, {}},
    MappingTest{"SELECT 2; SELECT 1;", "SELECT 1; SELECT 2;", {{0, 1}, {1, 0}}, {{0, 1}, {1, 0}}, {{1, 0}}},
    MappingTest{"SELECT 1; SELECT 2; SELECT 3;", "SELECT 1; SELECT 3; SELECT 2;",
        {{0, 0}, {1, 2}, {2, 1}},
        {{0, 0}, {1, 2}, {2, 1}},
        {{0, 0}, {2, 1}}},
    MappingTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        VIZ weather_avg USING LINE;
    )DQL",
        {{0, 0}, {1, 1}},
        {{0, 0}, {1, 1}},
        {{0, 0}, {1, 1}}},
    MappingTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 1 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 2 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL",
        {{0, 0}, {2, 2}},
        {{0, 0}, {2, 2}},
        {{0, 0}, {2, 2}}}
));

struct DiffTest {
    std::string_view t1;
    std::string_view t2;
    std::vector<ProgramMatcher::DiffOp> diff;

    friend std::ostream& operator<<(std::ostream& out, const DiffTest& param) {
        out << param.t1 << " | " << param.t2;
        return out;
    }
};
class DiffTestSuite: public ::testing::TestWithParam<DiffTest> {};

TEST_P(DiffTestSuite, DiffOps) {
    auto& param = GetParam();
    auto p1 = parser::ParserDriver::Parse(param.t1);
    auto p2 = parser::ParserDriver::Parse(param.t2);
    ProgramInstance pi1{param.t1, move(p1)};
    ProgramInstance pi2{param.t2, move(p2)};
    ProgramMatcherProxy matcher{pi1, pi2};
    auto diff = matcher.ComputeDiff();
    ASSERT_EQ(diff, param.diff);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, DiffTestSuite, ::testing::Values(
    DiffTest{"", "", {}},

    DiffTest{"SELECT 1; SELECT 2; SELECT 3;", "SELECT 1; SELECT 3; SELECT 2;", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::MOVE, 1, 2},
        {DiffOpCode::KEEP, 2, 1},
    }},

    DiffTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 1 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 2 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::UPDATE, 1, 1},
        {DiffOpCode::KEEP, 2, 2},
    }},

    DiffTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 2 INTO weather_avg FROM weather;
        SELECT 4;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        VIZ weather_avg USING LINE;
    )DQL", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::DELETE, 1},
        {DiffOpCode::DELETE, 2},
        {DiffOpCode::KEEP, 3, 1},
    }},

    DiffTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 4;
        SELECT 2 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 1 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::DELETE, 1},
        {DiffOpCode::UPDATE, 2, 1},
        {DiffOpCode::KEEP, 3, 2},
    }},

    DiffTest{R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 4;
        SELECT 2 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
    )DQL", R"DQL(
        EXTRACT weather FROM weather_csv USING CSV;
        SELECT 1 INTO weather_avg FROM weather;
        VIZ weather_avg USING LINE;
        VIZ weather_avg_2 USING BAR;
    )DQL", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::DELETE, 1},
        {DiffOpCode::UPDATE, 2, 1},
        {DiffOpCode::KEEP, 3, 2},
        {DiffOpCode::INSERT, std::nullopt, 3},
    }}
));

}  // namespace
