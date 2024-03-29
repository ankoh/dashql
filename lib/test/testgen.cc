// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/analyzer/analyzer.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "dashql/test/analyzer_tests.h"
#include "dashql/test/grammar_tests.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"
#include "nonstd/span.h"

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
        auto root = doc.child("tests");

        for (auto test : root.children()) {
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

arrow::Status generate_analyzer_tests(const std::filesystem::path& source_dir) {
    auto task_dir = source_dir / "test" / "analyzer" / "spec";
    for (auto& p : std::filesystem::directory_iterator(task_dir)) {
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
        auto root = doc.child("tests");

        auto program_task_type_tt = proto::task::ProgramTaskTypeTypeTable();
        auto task_status_code_tt = proto::task::TaskStatusCodeTypeTable();

        auto assert_ok = [](arrow::Status s, std::string_view what) {
            if (!s.ok()) {
                std::cout << "ERROR '" << what << "' failed with error: " << s.message() << std::endl;
                std::exit(1);
            }
        };

        for (auto test : root.children()) {
            auto name = test.attribute("name").value();
            std::cout << "  TEST " << name << std::endl;

            Analyzer analyzer;

            for (auto inst : test.children("step")) {
                // Unpack previous program
                auto inst_text = inst.child("text").text().get();
                auto inst_params = inst.child("parameters");
                std::vector<InputValue> inst_params_vec;
                for (auto& param : inst_params.children()) {
                    ARROW_ASSIGN_OR_RAISE(auto v, AnalyzerTest::GetInputValue(param));
                    inst_params_vec.push_back(v);
                }

                // Parse, instantiate and plan the previous program
                assert_ok(analyzer.ParseProgram(inst_text), "parsing of previous program");
                assert_ok(analyzer.InstantiateProgram(move(inst_params_vec)), "instantiation of previous program");
                assert_ok(analyzer.PlanProgram(), "planning of previous program");

                // Update the task status
                {
                    unsigned i = 0;
                    for (auto p : inst.child("graph").child("program").children()) {
                        auto status_str = p.attribute("status").as_string();
                        auto status = AnalyzerTest::GetTaskStatus(status_str);
                        ARROW_RETURN_NOT_OK(
                            analyzer.UpdateTaskStatus(proto::task::TaskClass::PROGRAM_TASK, i++, status));
                    }
                }
                inst.remove_children();
                AnalyzerTest::EncodePlan(inst, *analyzer.program_instance(), *analyzer.planned_graph());
            }
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
    return arrow::Status::OK();
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
    if (auto status = generate_analyzer_tests(source_dir); !status.ok()) {
        std::cout << "Error while generating analyzer tests: " << status.message() << std::endl;
    }
    return 0;
}
