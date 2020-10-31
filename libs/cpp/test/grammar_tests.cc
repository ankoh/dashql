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

using namespace dashql::parser;
using namespace std;

namespace {

struct GrammarTest {
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
    ryml::NodeRef expectedOutput;
};

struct GrammarTestSuite : public testing::TestWithParam<GrammarTest> {
    /// The grammar tests
    static std::unordered_map<std::string, std::vector<GrammarTest>> tests;
    /// Parse tests
    static nonstd::span<GrammarTest> FindTests(const char* name);
};

/// The grammar tests
std::unordered_map<std::string, std::vector<GrammarTest>> GrammarTestSuite::tests;
/// Find test files
nonstd::span<GrammarTest> GrammarTestSuite::FindTests(const char* name) {
    auto iter = tests.find(name);
    return (iter != tests.end()) ? iter->second : nonstd::span<GrammarTest>{};
}

TEST_P(GrammarTestSuite, OutputMatchesExpectation) {
    
}

INSTANTIATE_TEST_SUITE_P(GrammarSQLSelect, GrammarTestSuite, testing::ValuesIn(GrammarTestSuite::FindTests("select_sql.test")));

}

int main(int argc, char* argv[]) {
    testing::InitGoogleTest(&argc, argv);
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
        std::cout << "Grammar Test: " << p.path() << std::endl;

        // Read the file
        std::string buffer;
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in)
            continue;

        // Read file
        in.seekg(0, std::ios::end);
        buffer.resize(in.tellg());
        in.seekg(0, std::ios::beg);
        in.read(&buffer[0], buffer.size());
        in.close();

        const auto DELIMITER = "\n----\n";
        for (size_t prev = 0, next = buffer.find(DELIMITER, 0); prev != std::string::npos; prev = next, next = buffer.find("\n", prev)) {
            // Read test
            std::string_view text{buffer.data() + prev, next - prev};
            if (text.empty())
                break;

            auto tree = ryml::parse(c4::csubstr(text.data(), text.length()));
            auto tmp = ryml::Tree();
            tmp.rootref() |= ryml::MAP;
            tmp.merge_with(&tree, tree["expected"].id(), tmp.root_id());

            std::cout << tree["name"].val() << std::endl;
            std::cout << tree["input"].val() << std::endl;
            std::cout << tmp << std::endl;
        }
    }
    return RUN_ALL_TESTS();
}

