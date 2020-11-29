// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/action_planner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/test/action_graph_tests.h"
#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"

using namespace dashql;
using namespace dashql::test;
using namespace std;

namespace {

proto::syntax_dashql::ParameterType GetParameterType(std::string_view type) {
    auto tt = proto::syntax_dashql::ParameterTypeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]})
            return static_cast<proto::syntax_dashql::ParameterType>(i);
    }
    return proto::syntax_dashql::ParameterType::NONE;
}

proto::session::ParameterValueT GetParameterType(const pugi::xml_node& node) {
    auto type = GetParameterType(node.attribute("type").as_string());
    auto stmt = node.attribute("statement").as_int();
    auto value = node.attribute("value").as_string();
    proto::session::ParameterValueT result;
    result.origin_statement = stmt;
    result.type = type;
    result.value = value;
    return result;
}

}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Usage: ./action_testgen <dir>" << std::endl;
        exit(1);
    }
    if (!argv[1] || !std::filesystem::exists(argv[1])) {
        std::cout << "Invalid directory: " << argv[1] << std::endl;
        exit(1);
    }
    auto grammar_dir = std::filesystem::path{argv[1]};
    for (auto& p : std::filesystem::directory_iterator(grammar_dir)) {
        auto filename = p.path().filename().filename().string();

        // Is template file file
        auto out = p.path();
        if (out.extension() != ".xml") continue;
        out.replace_extension();
        if (out.extension() != ".tpl") continue;
        out.replace_extension(".xml");

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Open output stream
        std::cout << "FILE " << out << std::endl;
        std::ofstream outs;
        outs.open(out, std::ofstream::out | std::ofstream::trunc);

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);

        auto program_action_type_tt = proto::action::ProgramActionTypeTypeTable();
        auto action_status_code_tt = proto::action::ActionStatusCodeTypeTable();

        for (auto test : doc.children()) {
            auto name = test.attribute("name").value();
            std::cout << "  TEST " << name << std::endl;

            // Unpack previous program
            auto prev = test.child("previous");
            auto prev_text = prev.child("text").text().get();
            auto prev_params = prev.child("parameters");
            auto prev_program = parser::ParserDriver::Parse(prev_text);
            auto prev_program_text = std::string{prev_text};
            ProgramInstance prev_program_instance{prev_program_text, *prev_program};
            std::vector<proto::session::ParameterValueT> prev_param_values;
            for (auto param: prev_params.children()) {
                prev_param_values.push_back(GetParameterType(param));
            }
            for (auto& v: prev_param_values) {
                prev_program_instance.SetParameterValue(&v);
            }

            // Unpack next program
            auto next = test.child("next");
            auto next_text = next.child("text").text().get();
            auto next_params = next.child("parameters");
            auto next_program = parser::ParserDriver::Parse(next_text);
            auto next_program_text = std::string{next_text};
            ProgramInstance next_program_instance{next_program_text, *next_program};
            std::vector<proto::session::ParameterValueT> next_param_values;
            for (auto param: next_params.children()) {
                next_param_values.push_back(GetParameterType(param));
            }
            for (auto& v: next_param_values) {
                next_program_instance.SetParameterValue(&v);
            }

            // Plan the previous action graph
            ActionPlanner prev_planner{prev_program_instance};
            prev_planner.PlanActionGraph();
            auto prev_action_graph = prev_planner.Finish();

            // Plan the next action graph
            ActionPlanner next_planner{next_program_instance, &prev_program_instance, prev_action_graph.get()};
            next_planner.PlanActionGraph();
            auto next_action_graph = next_planner.Finish();

            prev.remove_children();
            ActionGraphTest::EncodeActionGraph(prev, prev_program_instance, *prev_action_graph);
            next.remove_children();
            ActionGraphTest::EncodeActionGraph(next, next_program_instance, *next_action_graph);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
    return 0;
}
