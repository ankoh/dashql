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

TEST(ProgramDiff, Select1Select2) {
    auto t1 = "SELECT 1";
    auto t2 = "SELECT 2";
    auto [p1, pb1] = Parse(t1);
    auto [p2, pb2] = Parse(t2);
    ASSERT_EQ(p1->statements()->size(), 1);
    ASSERT_EQ(p2->statements()->size(), 1);
    auto s1 = p1->statements()->Get(0);
    auto s2 = p2->statements()->Get(0);
    ProgramMatcher matcher{t1, t2, *p1, *p2};
    auto sim = matcher.ComputeSimilarity(*s1, *s2);
    ASSERT_EQ(sim.total_nodes - sim.matching_nodes, 1) << "total=" << sim.total_nodes << " matching=" << sim.matching_nodes;
}

}  // namespace
