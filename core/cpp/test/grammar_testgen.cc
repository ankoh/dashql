// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/parser/parser_driver.h"
#include "dashql/test/program_test_encoder.h"
#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"

using namespace dashql::parser;
using namespace std;

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Usage: ./grammar_testgen <dir>" << std::endl;
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

        // Split sections
        for (auto test : doc.children()) {
            // Copy expected
            auto name = test.attribute("name").as_string();
            auto input = test.child("input");
            auto input_sv = std::string_view{input.last_child().value()};

            /// Parse module
            auto program = ParserDriver::Parse(input_sv);

            /// Write output
            auto expected = test.append_child("expected");
            EncodeProgramTest(expected, *program, input_sv);

            std::cout << "  TEST " << name << std::endl;
        }

        // Write xml document
        doc.save(outs, "    ", pugi::format_default | pugi::format_no_declaration);
    }
    return 0;
}
