// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/common/substring_buffer.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace sx = dashql::proto::syntax;

namespace {

TEST(SubstringBufferTest, NumberSequence) {
    std::string_view text = "0 1 2 3 4 5 6 7 8 9 ";
    SubstringBuffer buffer{text, sx::Location(0, text.length())};
    ASSERT_EQ(buffer.str(), text);
    buffer.Replace(sx::Location(0, 2), "");
    ASSERT_EQ(buffer.str(), "1 2 3 4 5 6 7 8 9 ");
    buffer.Replace(sx::Location(0, 2), "0 ");
    ASSERT_EQ(buffer.str(), "0 1 2 3 4 5 6 7 8 9 ");
    buffer.Replace(sx::Location(2, 2), "A B ");
    ASSERT_EQ(buffer.str(), "0 A B 2 3 4 5 6 7 8 9 ");
    buffer.Replace(sx::Location(18, 2), "C ");
    ASSERT_EQ(buffer.str(), "0 A B 2 3 4 5 6 7 8 C ");
    buffer.Replace(sx::Location(20, 2), "D ");
    ASSERT_EQ(buffer.str(), "0 A B 2 3 4 5 6 7 8 C D ");
    buffer.Replace(sx::Location(6, 4), "E ");
    ASSERT_EQ(buffer.str(), "0 A B 2 E 5 6 7 8 C D ");
}

}  // namespace
