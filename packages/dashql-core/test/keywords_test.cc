#include "dashql/parser/grammar/keywords.h"

#include <algorithm>

#include "gtest/gtest.h"

using namespace dashql::parser;

namespace {

TEST(KeywordsTest, ConstLength) { EXPECT_EQ(Keyword::ConstLength("foo"), 3); }

TEST(KeywordsTest, KeywordsAreSorted) {
    auto keywords = Keyword::GetKeywords();
    auto keywords_are_sorted =
        std::is_sorted(keywords.begin(), keywords.end(), [](auto& l, auto& r) { return l.name < r.name; });
    EXPECT_TRUE(keywords_are_sorted);
}

TEST(KeywordsTest, ScannerTokenIdsMatchGeneratedParser) {
    ASSERT_NE(Keyword::Find("select"), nullptr);
    EXPECT_EQ(Keyword::Find("select")->scanner_token, Parser::token::FQL_SELECT);
    ASSERT_NE(Keyword::Find("graph_table"), nullptr);
    EXPECT_EQ(Keyword::Find("graph_table")->scanner_token, Parser::token::FQL_GRAPH_TABLE);
}

}  // namespace
