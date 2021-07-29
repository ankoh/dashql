// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/syntax_matcher.h"

#include <sstream>

#include "dashql/analyzer/program_instance.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

TEST(ASTMatcherTest, FetchStatement) {
    auto txt = R"CSV(
        FETCH weather_csv FROM http (
            url = 'https://localhost/test'
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root_id = program->statements[0]->root_node;
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_FETCH)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_FETCH_METHOD, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, 2)
                .MatchObject(sx::NodeType::OBJECT_SQL_QUALIFIED_NAME)
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_RELATION, 3)
                        .MatchString()
                }),
            sxm::Attribute(sx::AttributeKey::DSON_URL, 4)
                .MatchString()
        });
    // clang-format on

    auto matches = schema.Match(instance, stmt_root_id, 5);

    EXPECT_EQ(matches[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[4].status, NodeMatchStatus::MATCHED);
    EXPECT_TRUE(matches.IsFullMatch());

    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[3].data));
    ASSERT_EQ(std::get<std::string_view>(matches[3].data), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[4].data));
    ASSERT_EQ(std::get<std::string_view>(matches[4].data), "'https://localhost/test'");
}

TEST(ASTMatcherTest, MinimalError) {
    auto txt = R"CSV(
        VIZ weather_avg USING LINE (
            position = (row = 1, column = 2, width = 4, height = 15)
        )
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root_id = program->statements[0]->root_node;
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray()
        });
    // clang-format on

    auto matches = schema.Match(instance, stmt_root_id, 2);
    EXPECT_EQ(matches[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[1].status, NodeMatchStatus::MATCHED);
}

TEST(ASTMatcherTest, VizStatementPositionShort) {
    auto txt = R"CSV(
        VIZ weather_avg USING LINE (
            position = (row = 1, column = 2, width = 4, height = 15)
        )
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root_id = program->statements[0]->root_node;
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(10)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 11)
                .MatchArray()
                .MatchChildren({
                    sxm::Element(8)
                        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE)
                                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
                            sxm::Attribute(sx::AttributeKey::DSON_POSITION, 9)
                                .MatchDSON()
                                .MatchChildren({
                                    sxm::Attribute(sx::AttributeKey::DSON_ROW, 2)
                                        .MatchString(),
                                    sxm::Attribute(sx::AttributeKey::DSON_COLUMN, 0)
                                        .MatchString(),
                                    sxm::Attribute(sx::AttributeKey::DSON_WIDTH, 3)
                                        .MatchString(),
                                    sxm::Attribute(sx::AttributeKey::DSON_HEIGHT, 1)
                                        .MatchString(),
                                    sxm::Attribute(sx::AttributeKey::DSON_X, 4)
                                        .MatchString(),
                                    sxm::Attribute(sx::AttributeKey::DSON_Y, 5)
                                        .MatchString(),
                                }),
                        })
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET)
                .MatchObject(sx::NodeType::OBJECT_SQL_TABLE_REF),
        });
    // clang-format on

    auto matches = schema.Match(instance, stmt_root_id, 12);
    EXPECT_EQ(matches[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[4].status, NodeMatchStatus::MISSING);
    EXPECT_EQ(matches[5].status, NodeMatchStatus::MISSING);
}

TEST(ASTMatcherTest, FetchStatementFormat) {
    auto txt = R"CSV(
        FETCH weather_csv FROM http (
            url = format('https://cdn.dashql.com/demo/weather/%s', global.country)
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root_id = program->statements[0]->root_node;
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_FETCH)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_FETCH_METHOD, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, 2)
                .MatchObject(sx::NodeType::OBJECT_SQL_QUALIFIED_NAME)
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_RELATION, 3)
                        .MatchString()
                }),
            sxm::Attribute(sx::AttributeKey::DSON_URL, 4)
                .MatchObject(sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL)
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_ARGUMENTS, 5)
                        .MatchArray()
                        .MatchChildren({
                            sxm::Element(7)
                                .MatchString(),
                            sxm::Element()
                                .MatchObject(sx::NodeType::OBJECT_SQL_COLUMN_REF)
                                .MatchChildren({
                                    sxm::Attribute(sx::AttributeKey::SQL_COLUMN_REF_PATH)
                                        .MatchArray()
                                        .MatchChildren({
                                            sxm::Element(8).MatchString(),
                                            sxm::Element(9).MatchString(),
                                        })
                                })
                        }),
                    sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_NAME, 6)
                        .MatchString(),
                })
    });
    // clang-format on

    auto matches = schema.Match(instance, stmt_root_id, 10);
    EXPECT_EQ(matches[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[4].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[5].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[6].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[7].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[8].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matches[9].status, NodeMatchStatus::MATCHED);
    EXPECT_TRUE(matches.IsFullMatch());

    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[3].data));
    ASSERT_EQ(std::get<std::string_view>(matches[3].data), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[6].data));
    ASSERT_EQ(std::get<std::string_view>(matches[6].data), "format");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[7].data));
    ASSERT_EQ(std::get<std::string_view>(matches[7].data), "'https://cdn.dashql.com/demo/weather/%s'");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[8].data));
    ASSERT_EQ(std::get<std::string_view>(matches[8].data), "global");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matches[9].data));
    ASSERT_EQ(std::get<std::string_view>(matches[9].data), "country");
}

}  // namespace
