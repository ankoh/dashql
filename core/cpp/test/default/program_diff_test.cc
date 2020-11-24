// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/program_diff.h"
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
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
    ASSERT_EQ(matcher.CheckDeepEquality(*s1, *s2), param.are_equal);
}

TEST_P(SimilarityTestSuite, SimilarityEstimate) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
    ASSERT_EQ(matcher.EstimateSimilarity(*s1, *s2), param.estimate);
}

TEST_P(SimilarityTestSuite, Similarity) {
    auto& param = GetParam();
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);
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
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
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
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
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
    auto [p1, pb1] = Parse(param.t1);
    auto [p2, pb2] = Parse(param.t2);
    ProgramMatcherProxy matcher{param.t1, param.t2, *p1, *p2};
    auto diff = matcher.ComputeDiff();
    ASSERT_EQ(diff, param.diff);
}

INSTANTIATE_TEST_SUITE_P(ProgramDiff, DiffTestSuite, ::testing::Values(
    DiffTest{"SELECT 1; SELECT 2; SELECT 3;", "SELECT 1; SELECT 3; SELECT 2;", {
        {DiffOpCode::KEEP, 0, 0},
        {DiffOpCode::KEEP, 2, 1},
        {DiffOpCode::MOVE, 1, 2},
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
    }}
));

}  // namespace
