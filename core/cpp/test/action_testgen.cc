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
#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"

using namespace dashql;
using namespace std;

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

        for (auto test : doc.children()) {
            auto name = test.attribute("name").value();
            std::cout << "  TEST " << name << std::endl;

            // Inspect template
            auto prev = test.child("previous");
            auto prev_text = prev.child("text").last_child().value();
            auto prev_graph = prev.child("graph");
            auto prev_params = prev.child("parameters");
            auto next = test.child("next");
            auto next_text = test.child("text").last_child().value();
            auto next_params = test.child("parameters");

            /// Parse module
            auto prev_program = parser::ParserDriver::Parse(prev_text);
            ProgramInstance prev_program_instance{prev_text, *prev_program};

            // Generate initial action graph
            // ActionPlanner prev_planner{prev_program_instance};
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
    return 0;
}
