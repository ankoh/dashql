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

proto::syntax::ParameterType GetParameterType(std::string_view type) {
    auto tt = proto::syntax::ParameterTypeTypeTable();
    auto& names = tt->names;
    auto& num_elems = tt->num_elems;
    for (unsigned i = 0; i < num_elems; ++i) {
        if (type == std::string_view{names[i]}) return static_cast<proto::syntax::ParameterType>(i);
    }
    return proto::syntax::ParameterType::NONE;
}

ParameterValue GetParameter(const pugi::xml_node& node) {
    auto stmt = node.attribute("statement").as_int();
    auto value = node.attribute("value").as_string();
    auto type = node.attribute("type").as_string();
    auto v = Value::Parse(type, value);
    return {static_cast<size_t>(stmt), std::move(v)};
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

            for (auto inst: test.children("step")) {
                // Unpack previous program
                auto inst_text = inst.child("text").text().get();
                auto inst_params = inst.child("parameters");
                std::vector<ParameterValue> inst_params_vec;
                for (auto& param : inst_params.children()) {
                    inst_params_vec.push_back(GetParameter(param));
                }

                // Parse, instantiate and plan the previous program
                assert_ok(analyzer.ParseProgram(inst_text), "parsing of previous program");
                assert_ok(analyzer.InstantiateProgram(move(inst_params_vec)), "instantiation of previous program");
                assert_ok(analyzer.PlanProgram(), "planning of previous program");

                // Update the action status
                {
                    unsigned i = 0;
                    for (auto p : inst.child("graph").child("program").children()) {
                        auto status_str = p.attribute("status").as_string();
                        auto status = GetActionStatus(status_str);
                        analyzer.UpdateProgramActionStatus(i++, status);
                    }
                }
                inst.remove_children();
                AnalyzerTest::EncodePlan(inst, *analyzer.program_instance(), *analyzer.planned_graph());
            }
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
