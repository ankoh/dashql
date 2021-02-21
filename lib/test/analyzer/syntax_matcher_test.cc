// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/syntax_matcher.h"

#include <sstream>

#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include "dashql/proto_generated.h"
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

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_LOAD)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_METHOD, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, 2)
                .MatchArray()
                .MatchChildren({
                    sxm::Element(3)
                        .MatchString()
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_URL, 4)
                .MatchString()
        });
    // clang-format on

    std::array<NodeMatch, 5> matching;
    auto full_match = schema.Match(instance, stmt_root, matching);

    EXPECT_EQ(matching[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[4].status, NodeMatchStatus::MATCHED);
    EXPECT_TRUE(full_match);

    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[3].data));
    ASSERT_EQ(std::get<std::string_view>(matching[3].data), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[4].data));
    ASSERT_EQ(std::get<std::string_view>(matching[4].data), "'https://localhost/test'");
}

TEST(SyntaxMatcherTest, MinimalError) {
    auto txt = R"CSV(
        VIZ weather_avg USING LINE (
            pos = (r = 1, c = 2, w = 4, h = 15)
        )
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root = program->nodes[program->statements[0]->root_node];
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray()
        });
    // clang-format on

    std::array<NodeMatch, 2> matching;
    schema.Match(instance, stmt_root, matching);

    EXPECT_EQ(matching[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[1].status, NodeMatchStatus::MATCHED);
}

TEST(SyntaxMatcherTest, VizStatementPositionShort) {
    auto txt = R"CSV(
        VIZ weather_avg USING LINE (
            pos = (r = 1, c = 2, w = 4, h = 15)
        )
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root = program->nodes[program->statements[0]->root_node];
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
                            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_POSITION, 9)
                                .MatchOptions()
                                .MatchChildren({
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, 0)
                                        .MatchString(),
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, 1)
                                        .MatchString(),
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, 2)
                                        .MatchString(),
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, 3)
                                        .MatchString(),
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, 4)
                                        .MatchString(),
                                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, 5)
                                        .MatchString(),
                                }),
                        })
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET)
                .MatchObject(sx::NodeType::OBJECT_SQL_TABLE_REF),
        });
    // clang-format on

    std::array<NodeMatch, 12> matching;
    schema.Match(instance, stmt_root, matching);

    EXPECT_EQ(matching[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[4].status, NodeMatchStatus::MISSING);
    EXPECT_EQ(matching[5].status, NodeMatchStatus::MISSING);
}

TEST(SyntaxMatcherTest, LoadStatementFormat) {
    auto txt = R"CSV(
        LOAD weather_csv FROM http (
            url = format('https://cdn.dashql.com/demo/weather/%s', global.country)
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    auto stmt_root = program->nodes[program->statements[0]->root_node];
    ProgramInstance instance{txt, move(program)};

    // clang-format off
    auto schema = sxm::Element(0)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_LOAD)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_METHOD, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, 2)
                .MatchArray()
                .MatchChildren({
                    sxm::Element(3)
                        .MatchString()
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_URL, 4)
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

    std::array<NodeMatch, 10> matching;
    auto full_match = schema.Match(instance, stmt_root, matching);

    EXPECT_EQ(matching[0].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[1].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[2].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[3].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[4].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[5].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[6].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[7].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[8].status, NodeMatchStatus::MATCHED);
    EXPECT_EQ(matching[9].status, NodeMatchStatus::MATCHED);
    EXPECT_TRUE(full_match);

    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[3].data));
    ASSERT_EQ(std::get<std::string_view>(matching[3].data), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[6].data));
    ASSERT_EQ(std::get<std::string_view>(matching[6].data), "format");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[7].data));
    ASSERT_EQ(std::get<std::string_view>(matching[7].data), "'https://cdn.dashql.com/demo/weather/%s'");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[8].data));
    ASSERT_EQ(std::get<std::string_view>(matching[8].data), "global");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(matching[9].data));
    ASSERT_EQ(std::get<std::string_view>(matching[9].data), "country");
}

}  // namespace
