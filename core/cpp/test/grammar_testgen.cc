// Copyright (c) 2020 The DashQL Authors

#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "dashql/parser/parser_driver.h"
#include "dashql/test/yaml_encoder.h"
#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"
#include "gtest/internal/gtest-internal.h"

using namespace dashql::parser;
using namespace std;

constexpr std::string_view DELIMITER = "\n----\n";
constexpr std::string_view DELIMITER_OUT = DELIMITER.substr(1);

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
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".tpl") continue;

        // Read the file
        auto buffer = std::make_shared<std::string>();
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Read file
        in.seekg(0, std::ios::end);
        buffer->resize(in.tellg());
        in.seekg(0, std::ios::beg);
        in.read(buffer->data(), buffer->size());
        in.close();

        // Write the output file
        auto out_path = p.path();
        out_path.replace_extension();
        std::cout << "FILE " << out_path << std::endl;
        std::ofstream out_fs;
        out_fs.open(out_path, std::ofstream::out | std::ofstream::trunc);

        // Split sections
        for (size_t prev = 0, next = 0; prev != std::string::npos && prev < buffer->size(); prev = next) {
            next = buffer->find(DELIMITER, prev);
            next = (next == std::string::npos) ? buffer->size() : next;

            // Is empty?
            std::string_view text{buffer->data() + prev, next - prev};
            if (text.empty()) break;

            // Copy expected
            auto tree = ryml::parse(c4::csubstr(text.data(), text.length()));
            auto name = tree["name"].val();
            auto input = tree["input"].val();
            auto input_strv = std::string_view{input.data(), input.size()};

            /// Parse module
            flatbuffers::FlatBufferBuilder builder;
            auto m_ofs = ParserDriver::Parse(builder, input_strv);
            builder.Finish(m_ofs);
            auto module = flatbuffers::GetRoot<sx::Program>(builder.GetBufferPointer());

            /// Write output
            ryml::Tree out;
            auto out_root = out.rootref();
            out_root |= ryml::MAP;
            out_root["name"] << name;
            out_root["input"] << input;
            EncodeTestExpectation(out_root["expected"], *module, input_strv);

            std::cout << "  TEST " << name << std::endl;
            if (prev > 0) {
                out_fs << DELIMITER_OUT;
            }
            out_fs << out;

            // Skip delimiter
            if (next != std::string::npos) next += DELIMITER.size();
        }
    }
    return 0;
}
