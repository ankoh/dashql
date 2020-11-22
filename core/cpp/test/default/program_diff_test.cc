// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/program_diff.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace fb = flatbuffers;

namespace {

std::pair<const sx::Program*, fb::DetachedBuffer> Parse(std::string_view text) {
    fb::FlatBufferBuilder builder;
    auto ofs = parser::ParserDriver::Parse(builder, text);
    builder.Finish(ofs);
    auto buffer = builder.Release();
    auto program = fb::GetRoot<sx::Program>(buffer.data());
    return {program, move(buffer)};
}

TEST(ProgramDiff, EqualConst) {
    auto t1 = "SELECT 1";
    auto t2 = "SELECT 1";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*p1->statements()->Get(0), *p2->statements()->Get(0));
    ASSERT_TRUE(sim.Equal());
}

TEST(ProgramDiff, DifferentConst) {
    auto t1 = "SELECT 1";
    auto t2 = "SELECT 2";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*p1->statements()->Get(0), *p2->statements()->Get(0));
    ASSERT_FALSE(sim.Equal());
    ASSERT_EQ(sim.total_nodes - sim.matching_nodes, 1);
}

TEST(ProgramDiff, EqualColumnRefs) {
    auto t1 = "select c from b where c = global.a";
    auto t2 = "select c from b where c = global.a";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*p1->statements()->Get(0), *p2->statements()->Get(0));
    ASSERT_TRUE(sim.Equal());
}

TEST(ProgramDiff, DifferentColumnRef) {
    auto t1 = "select c from b where c = global.a";
    auto t2 = "select c from b where c = global.d";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*p1->statements()->Get(0), *p2->statements()->Get(0));
    ASSERT_FALSE(sim.Equal());
    ASSERT_EQ(sim.total_nodes - sim.matching_nodes, 1);
}

TEST(ProgramDiff, DifferentSelect) {
    auto t1 = "select 1";
    auto t2 = "select c from b where c = global.d";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*p1->statements()->Get(0), *p2->statements()->Get(0));
    ASSERT_FALSE(sim.Equal());
}

}  // namespace
