// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_matcher.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
using NODE = sx::NodeType;
using KEY = sx::AttributeKey;

namespace {

TEST(NodeSchemaTest, LoadStatement) {
    auto txt = R"CSV(
        LOAD weather_csv FROM http (
            url = 'https://localhost/test'
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    ProgramInstance instance{txt, move(program)};

    NodeSchema *load_stmt = nullptr;
    NodeSchema *load_method = nullptr;
    NodeSchema *stmt_name = nullptr;
    NodeSchema *url_value = nullptr;
    auto schema = NodeSchema::Object(NODE::OBJECT_DASHQL_LOAD, {
        {KEY::DASHQL_LOAD_METHOD,  NodeSchema::Enum(NODE::ENUM_DASHQL_LOAD_METHOD_TYPE, &load_method)},
        {KEY::DASHQL_STATEMENT_NAME, NodeSchema::Array({
            NodeSchema::String(&stmt_name)
        })},
        {KEY::DASHQL_OPTION_URL, NodeSchema::Object(NODE::OBJECT_SQL_CONST, {
            {KEY::SQL_CONST_TYPE,  NodeSchema::Enum(NODE::ENUM_SQL_CONST_TYPE)},
            {KEY::SQL_CONST_VALUE, NodeSchema::String(&url_value)}
        })}
    }, &load_stmt);
    auto stmt_root = instance.program().statements[0]->root_node;
    auto& stmt_node = instance.program().nodes[stmt_root];
    auto full_match = instance.MatchSchema(stmt_node, schema);

    ASSERT_TRUE(full_match);
    ASSERT_EQ(stmt_node.node_type(), NODE::OBJECT_DASHQL_LOAD);

    ASSERT_TRUE(!!load_stmt);
    ASSERT_TRUE(!!load_method);
    ASSERT_TRUE(!!stmt_name);
    ASSERT_TRUE(!!url_value);
    ASSERT_EQ(load_stmt->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(load_method->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(stmt_name->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(url_value->matching, NodeSchemaMatching::MATCHED);
    ASSERT_TRUE(std::holds_alternative<std::string_view>(stmt_name->value));
    ASSERT_EQ(std::get<std::string_view>(stmt_name->value), "weather_csv");
    ASSERT_TRUE(std::holds_alternative<std::string_view>(url_value->value));
    ASSERT_EQ(std::get<std::string_view>(url_value->value), "'https://localhost/test'");
}

TEST(NodeSchemaTest, LoadStatementFormat) {
    auto txt = R"CSV(
        LOAD weather_csv FROM http (
            url = format('https://cdn.dashql.com/demo/weather/%s', global.country)
        );
    )CSV";
    auto program = parser::ParserDriver::Parse(txt);
    ASSERT_EQ(program->statements.size(), 1);
    ProgramInstance instance{txt, move(program)};

    NodeSchema *load_stmt = nullptr;
    NodeSchema *load_method = nullptr;
    NodeSchema *stmt_name = nullptr;
    NodeSchema *func_name = nullptr;
    auto schema = NodeSchema::Object(NODE::OBJECT_DASHQL_LOAD, {
        {KEY::DASHQL_LOAD_METHOD,  NodeSchema::Enum(NODE::ENUM_DASHQL_LOAD_METHOD_TYPE, &load_method)},
        {KEY::DASHQL_STATEMENT_NAME, NodeSchema::Array({
            NodeSchema::String(&stmt_name)
        })},
        {KEY::DASHQL_OPTION_URL, NodeSchema::Object(NODE::OBJECT_DASHQL_FUNCTION_CALL, {
            {KEY::SQL_FUNCTION_ARGUMENTS, NodeSchema::Array({
                NodeSchema::Object(NODE::OBJECT_SQL_CONST, {
                    {KEY::SQL_CONST_TYPE, NodeSchema::Enum(NODE::ENUM_SQL_CONST_TYPE)},
                    {KEY::SQL_CONST_VALUE, NodeSchema::String()}
                }),
                NodeSchema::Object(NODE::OBJECT_SQL_COLUMN_REF, {
                    {KEY::SQL_COLUMN_REF_PATH, NodeSchema::Array({
                        NodeSchema::String(),
                        NodeSchema::String(),
                    })},
                }),
            })},
            {KEY::SQL_FUNCTION_NAME, NodeSchema::String(&func_name)}
        })}
    }, &load_stmt);
    auto stmt_root = instance.program().statements[0]->root_node;
    auto& stmt_node = instance.program().nodes[stmt_root];
    auto full_match = instance.MatchSchema(stmt_node, schema);

    ASSERT_TRUE(full_match);
    ASSERT_EQ(stmt_node.node_type(), NODE::OBJECT_DASHQL_LOAD);

    ASSERT_TRUE(!!load_stmt);
    ASSERT_TRUE(!!load_method);
    ASSERT_TRUE(!!stmt_name);
    ASSERT_EQ(load_stmt->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(load_method->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(stmt_name->matching, NodeSchemaMatching::MATCHED);
}

}
