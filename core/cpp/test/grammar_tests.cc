// Copyright (c) 2020 The DashQL Authors

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

namespace {

/// A grammar param
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
    GrammarParamTestsParam() : buffer(), text(), tree(), name(), input(), expected() {}

    friend std::ostream& operator<<(std::ostream& out, const GrammarParamTestsParam& param) {
        out << param.input;
        return out;
    }
};

/// Print a test name
struct PrintTestName {
    std::string operator()(const ::testing::TestParamInfo<GrammarParamTestsParam>& info) const {
        return std::string{info.param.name};
    }
};

/// Parameterized parameter test
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

::testing::AssertionResult IsEqual(const ryml::Tree& actual, const ryml::Tree& expected) {
    auto expected_str = ryml::emitrs<std::string>(expected);
    auto actual_str = ryml::emitrs<std::string>(actual);
    if (expected_str == actual_str) return ::testing::AssertionSuccess();

    std::stringstream err;

    err << std::endl;
    err << "OUTPUT" << std::endl;
    err << "----------------------------------------" << std::endl;
    err << actual_str << std::endl;

    err << "EXPECTED" << std::endl;
    err << "----------------------------------------" << std::endl;
    std::vector<std::string> expected_lines, actual_lines;
    ::testing::internal::SplitString(expected_str, '\n', &expected_lines);
    ::testing::internal::SplitString(actual_str, '\n', &actual_lines);
    err << ::testing::internal::edit_distance::CreateUnifiedDiff(actual_lines, expected_lines);
    err << std::endl;

    return ::testing::AssertionFailure() << err.str();
}

TEST_P(GrammarParamTests, Test) {
    auto& param = GetParam();
    auto program = ParserDriver::Parse(param.input);

    ryml::Tree out;
    EncodeTestExpectation(out.rootref(), *program, param.input);

    ASSERT_TRUE(IsEqual(out, param.expected));
}

INSTANTIATE_TEST_SUITE_P(DashQLStatement, GrammarParamTests,
                         testing::ValuesIn(GrammarParamTests::FindTests("dashql_statement.test")), PrintTestName());
INSTANTIATE_TEST_SUITE_P(Demo, GrammarParamTests, testing::ValuesIn(GrammarParamTests::FindTests("scripts_demo.test")),
                         PrintTestName());
INSTANTIATE_TEST_SUITE_P(SQLSelect, GrammarParamTests,
                         testing::ValuesIn(GrammarParamTests::FindTests("sql_select.test")), PrintTestName());

}  // namespace

constexpr std::string_view DELIMITER = "\n----\n";

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Usage: ./grammar_test <dir>" << std::endl;
        exit(1);
    }
    if (!argv[1] || !std::filesystem::exists(argv[1])) {
        std::cout << "Invalid directory: " << argv[1] << std::endl;
        exit(1);
    }
    auto grammar_dir = std::filesystem::path{argv[1]};
    for (auto& p : std::filesystem::directory_iterator(grammar_dir)) {
        auto filename = p.path().filename().string();
        if (p.path().extension().string() != ".test") continue;

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
            if (text.empty()) break;

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

            // Skip delimiter
            if (next != std::string::npos) next += DELIMITER.size();
        }

        // Register test
        GrammarParamTests::tests.insert({filename, move(tests)});
    }

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
