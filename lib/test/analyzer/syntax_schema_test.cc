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
using N = sx::NodeType;
using K = sx::AttributeKey;

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
    auto stmt_root = instance.program().statements[0]->root_node;
    auto& stmt_node = instance.program().nodes[stmt_root];

    NodeSchema *load_stmt = nullptr;
    NodeSchema *load_method = nullptr;
    NodeSchema *stmt_name = nullptr;
    NodeSchema *url_value = nullptr;

    auto schema = NodeSchema::Object(N::OBJECT_DASHQL_LOAD, {
        NodeSchema::Enum(N::ENUM_DASHQL_LOAD_METHOD_TYPE, K::DASHQL_LOAD_METHOD, &load_method),
        NodeSchema::Array(K::DASHQL_STATEMENT_NAME, {
            NodeSchema::String(&stmt_name)
        }),
        NodeSchema::Object(N::OBJECT_SQL_CONST, K::DASHQL_OPTION_URL, {
            NodeSchema::Enum(N::ENUM_SQL_CONST_TYPE, K::SQL_CONST_TYPE),
            NodeSchema::String(K::SQL_CONST_VALUE, &url_value)
        })
    }, &load_stmt);
    instance.MatchSchema(stmt_node, schema);

    ASSERT_EQ(stmt_node.node_type(), N::OBJECT_DASHQL_LOAD);

    ASSERT_TRUE(!!load_stmt);
    ASSERT_TRUE(!!load_method);
    ASSERT_TRUE(!!stmt_name);
    ASSERT_TRUE(!!url_value);
    ASSERT_EQ(load_stmt->matching, NodeSchemaMatching::MATCHED);
    ASSERT_EQ(load_method->matching, NodeSchemaMatching::MATCHED);
}

}
