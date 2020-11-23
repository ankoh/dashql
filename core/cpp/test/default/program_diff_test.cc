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

    using ProgramMatcher::FindUniquePairs;
};

std::pair<const sx::Program*, fb::DetachedBuffer> Parse(std::string_view text) {
    fb::FlatBufferBuilder builder;
    auto ofs = parser::ParserDriver::Parse(builder, text);
    builder.Finish(ofs);
    auto buffer = builder.Release();
    auto program = fb::GetRoot<sx::Program>(buffer.data());
    return {program, move(buffer)};
}

void TestSingleStatements(std::string_view t1, std::string_view t2, bool are_equal, SimilarityEstimate estimate, std::optional<size_t> diff_node_count = std::nullopt) {
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcherProxy matcher{t1, t2, *p1, *p2};
    auto s1 = p1->statements()->Get(0), s2 = p2->statements()->Get(0);

    ASSERT_EQ(matcher.CheckDeepEquality(*s1, *s2), are_equal);
    ASSERT_EQ(matcher.EstimateSimilarity(*s1, *s2), estimate);

    auto diff = matcher.ComputeDiff(*s1, *s2);
    ASSERT_EQ(diff.Equal(), are_equal);
    if (diff_node_count)
        ASSERT_EQ(diff.diff_nodes.size(), *diff_node_count);
}

TEST(ProgramDiff, SingleStatements) {
    TestSingleStatements("SELECT 1", "SELECT 1", true, SimilarityEstimate::EQUAL, 0);
    TestSingleStatements("SELECT 1", "SELECT 2", false, SimilarityEstimate::SIMILAR, 1);
    TestSingleStatements(
        "select c from b where c = global.a",
        "select c from b where c = global.a",
        true, SimilarityEstimate::EQUAL, 0);
    TestSingleStatements(
        "select c from b where c = global.a",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR, 1);
    TestSingleStatements(
        "select 1",
        "select c from b where c = global.d",
        false, SimilarityEstimate::SIMILAR);
    TestSingleStatements(
        "viz whether_avg using line",
        "select c from b where c = global.d",
        false, SimilarityEstimate::NOT_EQUAL);
}

void TestUniquePairs(std::string_view t1, std::string_view t2, const std::vector<size_t>& ids0, const std::vector<size_t>& ids1, const std::vector<std::pair<size_t, size_t>>& expected) {
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ProgramMatcherProxy matcher{t1, t2, *p1, *p2};
    std::vector<std::pair<size_t, size_t>> unique_pairs;
    matcher.FindUniquePairs(ids0, ids1, unique_pairs);
    ASSERT_EQ(unique_pairs, expected);
}

TEST(ProgramDiff, UniquePairs) {
    TestUniquePairs(R"DQL(
        SELECT 1;
    )DQL", R"DQL(
        SELECT 1;
    )DQL", {0}, {0}, {{0, 0}});

    TestUniquePairs(R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 1;
    )DQL", {0, 1}, {0}, {{1, 0}});

    TestUniquePairs(R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {{1, 1}});

    TestUniquePairs(R"DQL(
        SELECT 2;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {}, {});

    TestUniquePairs(R"DQL(
        SELECT 1;
        SELECT 1;
    )DQL", R"DQL(
        SELECT 3;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {});

    TestUniquePairs(R"DQL(
        SELECT 1;
        SELECT 2;
    )DQL", R"DQL(
        SELECT 1;
        SELECT 1;
    )DQL", {0, 1}, {0, 1}, {});
}

}  // namespace
