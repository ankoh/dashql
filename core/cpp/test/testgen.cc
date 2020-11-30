// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/action_planner.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/test/grammar_tests.h"
#include "dashql/test/action_graph_tests.h"
#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"

using namespace dashql;
using namespace dashql::test;
using namespace std;

using namespace dashql;
using namespace std;

namespace {

void generate_grammar_tests(const std::filesystem::path& source_dir) {
    auto grammar_dir = source_dir / "test" / "grammar";
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

        for (auto test : doc.children()) {
            // Copy expected
            auto name = test.attribute("name").as_string();
            std::cout << "  TEST " << name << std::endl;

            /// Parse module
            auto input = test.child("input");
            auto input_sv = std::string_view{input.last_child().value()};
            auto program = parser::ParserDriver::Parse(input_sv);

            /// Write output
            auto expected = test.append_child("expected");
            test::GrammarTest::EncodeProgram(expected, *program, input_sv);
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

proto::action::ActionStatusCode GetActionStatus(std::string_view type) {
    auto tt = proto::action::ActionStatusCodeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]})
            return static_cast<proto::action::ActionStatusCode>(i);
    }
    return proto::action::ActionStatusCode::NONE;
}

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

void generate_action_tests(const std::filesystem::path& source_dir) {
    auto action_dir = source_dir / "test" / "action";
    for (auto& p : std::filesystem::directory_iterator(action_dir)) {
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
            ActionPlanner prev_planner{prev_program_instance};
            prev_planner.PlanActionGraph();
            auto prev_action_graph = prev_planner.Finish();
            {
                unsigned i = 0;
                for (auto p: prev.child("graph").child("program").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = GetActionStatus(status_str);
                    if (i < prev_action_graph->program_actions.size()) {
                        auto s = std::make_unique<proto::action::ActionStatus>();
                        s->mutate_status_code(status);
                        prev_action_graph->program_actions[i++]->action_status = move(s);
                    }

                }
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
}

}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Usage: ./testgen <source_dir>" << std::endl;
        exit(1);
    }
    if (!argv[1] || !std::filesystem::exists(argv[1])) {
        std::cout << "Invalid directory: " << argv[1] << std::endl;
        exit(1);
    }
    std::filesystem::path source_dir{argv[1]};
    generate_grammar_tests(source_dir);
    generate_action_tests(source_dir);
    return 0;
}
