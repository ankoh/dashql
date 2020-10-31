// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/common/span.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/test/yaml_encoder.h"
#include "gtest/gtest.h"
#include "flatbuffers/flatbuffers.h"

#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>
#include <string_view>

using namespace dashql::parser;
using namespace std;

namespace {

struct GrammarParamTestsParam {
    /// The shared string
    std::shared_ptr<std::string> buffer;
    /// The full test case
    std::string_view text;
    /// The tree
    ryml::Tree tree;
    /// The name
    std::string_view name;
    /// The input
    std::string_view input;
    /// The expected output
    ryml::Tree expected;

    /// Constructor
    GrammarParamTestsParam()
        : buffer(), text(), tree(), name(), input(), expected() {}
};

struct GrammarParamTests : public testing::TestWithParam<GrammarParamTestsParam> {
    /// The grammar tests
    static std::unordered_map<std::string, std::vector<GrammarParamTestsParam>> tests;
    /// Parse tests
    static nonstd::span<GrammarParamTestsParam> FindTests(const char* name);
};

/// The grammar tests
std::unordered_map<std::string, std::vector<GrammarParamTestsParam>> GrammarParamTests::tests = {};
/// Find test files
nonstd::span<GrammarParamTestsParam> GrammarParamTests::FindTests(const char* name) {
    auto iter = tests.find(name);
    return (iter != tests.end()) ? iter->second : nonstd::span<GrammarParamTestsParam>{};
}

TEST_P(GrammarParamTests, Test) {
    auto& param = GetParam();
}

INSTANTIATE_TEST_SUITE_P(SQLSelect, GrammarParamTests, testing::ValuesIn(GrammarParamTests::FindTests("sql_select.test")));

}


int main(int argc, char* argv[]) {
    constexpr std::string_view DELIMITER = "\n----\n";
    if (argc < 2) {
        std::cout << "Usage: ./grammar_test <dir>" << std::endl;
        exit(1);
    }
    if (!argv[1] || !std::filesystem::exists(argv[1])) {
        std::cout << "Invalid directory: " << argv[1] << std::endl;
        exit(1);
    }
    auto grammar_dir = std::filesystem::path{argv[1]};
    for(auto& p: std::filesystem::directory_iterator(grammar_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".test")
            continue;

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

        std::vector<GrammarParamTestsParam> tests;

        // Split sections
        for (size_t prev = 0, next = 0; prev != std::string::npos && prev < buffer->size(); prev = next) {
            next = buffer->find(DELIMITER, prev);
            next = (next == std::string::npos) ? buffer->size() : next;

            // Is empty?
            std::string_view text{buffer->data() + prev, next - prev};
            if (text.empty())
                break;

            tests.emplace_back();
            auto& test = tests.back();

            // Copy expected
            test.tree = ryml::parse(c4::csubstr(text.data(), text.length()));
            auto name = test.tree["name"].val();
            auto input = test.tree["input"].val();

            // Create test
            test.buffer = buffer;
            test.text = text;
            test.expected.rootref() |= ryml::MAP;
            test.expected.merge_with(&test.tree, test.tree["expected"].id(), test.tree.root_id());
            test.name = {name.data(), name.size()};
            test.input = {input.data(), input.size()};

            std::cout << "[" << filename << "] test=" << test.name << std::endl;

            // Skip delimiter
            if (next != std::string::npos)
                next += DELIMITER.size();
        }

        // Register test
        GrammarParamTests::tests.insert({filename, move(tests)});
    }

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}

