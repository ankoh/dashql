// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/analyzer/analyzer.h"
#include "dashql/common/span.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/test/analyzer_tests.h"
#include "dashql/test/grammar_tests.h"
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
    auto grammar_dir = source_dir / "test" / "parser" / "spec";
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
        if (type == std::string_view{names[i]}) return static_cast<proto::action::ActionStatusCode>(i);
    }
    return proto::action::ActionStatusCode::NONE;
}

proto::syntax_dashql::ParameterType GetParameterType(std::string_view type) {
    auto tt = proto::syntax_dashql::ParameterTypeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::syntax_dashql::ParameterType>(i);
    }
    return proto::syntax_dashql::ParameterType::NONE;
}

std::unique_ptr<proto::analyzer::ParameterValueT> GetParameter(const pugi::xml_node& node) {
    auto type = GetParameterType(node.attribute("type").as_string());
    auto stmt = node.attribute("statement").as_int();
    auto value = node.attribute("value").as_string();
    auto result = std::make_unique<proto::analyzer::ParameterValueT>();
    result->origin_statement = stmt;
    result->type = type;
    result->value = value;
    return move(result);
}

void generate_analyzer_tests(const std::filesystem::path& source_dir) {
    auto action_dir = source_dir / "test" / "analyzer" / "spec";
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

        auto assert_ok = [](Signal s, std::string_view what) {
            if (!s) {
                std::cout << "ERROR '" << what << "' failed with error: " << s.err().message() << std::endl;
                std::exit(1);
            }
        };

        for (auto test : doc.children()) {
            auto name = test.attribute("name").value();
            std::cout << "  TEST " << name << std::endl;

            Analyzer analyzer;

            // Unpack previous program
            auto prev = test.child("previous");
            auto prev_text = prev.child("text").text().get();
            auto prev_params = prev.child("parameters");
            proto::analyzer::ProgramParametersT prev_params_obj;
            for (auto& param : prev_params.children()) {
                prev_params_obj.values.push_back(GetParameter(param));
            }

            // Parse, instantiate and plan the previous program
            assert_ok(analyzer.ParseProgram(prev_text), "parsing of previous program");
            assert_ok(analyzer.InstantiateProgram(prev_params_obj), "instantiation of previous program");
            assert_ok(analyzer.PlanProgram(), "planning of previous program");

            // Update the action status
            {
                unsigned i = 0;
                for (auto p : prev.child("graph").child("program").children()) {
                    auto status_str = p.attribute("status").as_string();
                    auto status = GetActionStatus(status_str);
                    analyzer.UpdateProgramActionStatus(i++, status);
                }
            }
            prev.remove_children();
            AnalyzerTest::EncodePlan(prev, *analyzer.program_instance(), *analyzer.planned_graph());

            // Unpack next program
            auto next = test.child("next");
            auto next_text = next.child("text").text().get();
            auto next_params = next.child("parameters");
            proto::analyzer::ProgramParametersT next_params_obj;
            for (auto& param : next_params.children()) {
                next_params_obj.values.push_back(GetParameter(param));
            }

            // Parse, instantiate and plan the next program
            assert_ok(analyzer.ParseProgram(next_text), "parsing of next program");
            assert_ok(analyzer.InstantiateProgram(next_params_obj), "instantiation of next program");
            assert_ok(analyzer.PlanProgram(), "planning of next program");
            next.remove_children();
            AnalyzerTest::EncodePlan(next, *analyzer.program_instance(), *analyzer.planned_graph());
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
}

}  // namespace

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
    generate_analyzer_tests(source_dir);
    return 0;
}
