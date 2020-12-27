// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_ACTION_GRAPH_TESTS_H_
#define INCLUDE_DASHQL_PARSER_TEST_ACTION_GRAPH_TESTS_H_

#include <filesystem>
#include <string>

#include "gtest/gtest.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

struct ActionGraphTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const ActionGraphTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The previous program text
    std::string prev_program_text;
    /// The next program text
    std::string next_program_text;
    /// The previous graph
    pugi::xml_document prev_graph;
    /// The expected next graph
    pugi::xml_document expected_next_graph;

    /// Encode the action graph
    static void EncodeActionGraph(pugi::xml_node& root, const ProgramInstance& program, const proto::action::ActionGraphT& graph);
};

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_ACTION_GRAPH_TESTS_H_
