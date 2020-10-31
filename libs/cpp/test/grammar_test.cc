// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"
#include "dashql/parser/test/yaml_encoder.h"
#include "gtest/gtest.h"
#include "flatbuffers/flatbuffers.h"

#include <fstream>

using namespace dashql::parser;
using namespace std;

namespace {

class GrammarTestParam {
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

class GrammarTest : public testing::TestWithParam<GrammarTestParam> {
    public:

    /// Parse the test file
    static std::vector<GrammarTestParam> ParseTestFile(std::filesystem::path& path);
    /// Parse tests
    static std::vector<GrammarTestParam> ParseTests(const char* name);
};

std::vector<GrammarTestParam> GrammarTest::ParseTestFile(std::filesystem::path& path) {
    std::vector<GrammarTestParam> tests;

    // Read the file
    std::string buffer;
    std::ifstream in(path.filename(), std::ios::in | std::ios::binary);
    if (in) {
        in.seekg(0, std::ios::end);
        buffer.resize(in.tellg());
        in.seekg(0, std::ios::beg);
        in.read(&buffer[0], buffer.size());
        in.close();
        return tests;
    }

    const auto DELIMITER = "\n----\n";
    for (size_t prev = 0, next = buffer.find(DELIMITER, 0); prev != std::string::npos; prev = next, next = buffer.find("\n", prev)) {
        // Read test
        std::string_view text{buffer.data() + prev, next - prev};
        if (text.empty())
            break;

        auto tree = ryml::parse(c4::csubstr(text.data(), text.length()));

        std::cout << "name: " << tree["name"];
        std::cout << "input" << tree["input"];
        std::cout << "expected" << tree["expected"];
    }

    return tests;
}

std::vector<GrammarTestParam> GrammarTest::ParseTests(const char* name) {
    return {};
}

TEST_P(GrammarTest, OutputMatchesExpectation) {
    
}

INSTANTIATE_TEST_SUITE_P(GrammarSQLSelect, GrammarTest, testing::ValuesIn(GrammarTest::ParseTests("select_sql.test")));

}
