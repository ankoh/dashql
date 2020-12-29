// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(SyntaxMatcherTest, LoadStatement) {
    auto txt = R"CSV(
        LOAD weather_csv FROM http (
            url = 'https://localhost/test'
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root = program->nodes[program->statements[0]->root_node];
    ProgramInstance instance{txt, move(program)};

    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_LOAD)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_METHOD, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, 2)
                .MatchArray()
                .MatchChildren(NODE_MATCHERS(
                    sxm::Element(3)
                        .MatchString()
                )),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_URL, 4)
                .MatchObject(sx::NodeType::OBJECT_SQL_CONST)
                .MatchChildren(NODE_MATCHERS(
                    sxm::Attribute(sx::AttributeKey::SQL_CONST_TYPE, 5)
                        .MatchEnum(sx::NodeType::ENUM_SQL_CONST_TYPE),
                    sxm::Attribute(sx::AttributeKey::SQL_CONST_VALUE, 6)
                        .MatchString(),
                ))
    ));

    std::array<NodeMatching, 7> matching;
    auto full_match = schema.Match(instance, stmt_root, matching);

    EXPECT_EQ(matching[0].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[1].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[2].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[3].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[4].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[5].status, NodeMatchingStatus::MATCHED);
    EXPECT_EQ(matching[6].status, NodeMatchingStatus::MATCHED);
    EXPECT_TRUE(full_match);

    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[3].value));
    ASSERT_EQ(std::get<std::string_view>(matching[3].value), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[6].value));
    ASSERT_EQ(std::get<std::string_view>(matching[6].value), "'https://localhost/test'");
}

}
