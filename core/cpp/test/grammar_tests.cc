// Copyright (c) 2020 The DashQL Authors

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

namespace {

/// A grammar param
struct GrammarParamTestsParam {
    /// The name
    std::string name;
    /// The input
    std::string input;
    /// The expected output
    std::shared_ptr<pugi::xml_document> expected;

    /// Constructor
    GrammarParamTestsParam() : name(), input(), expected() {}

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

::testing::AssertionResult IsEqual(const pugi::xml_node& actual, const pugi::xml_node& expected) {
    std::stringstream expected_ss;
    std::stringstream actual_ss;
    expected.print(expected_ss);
    actual.print(actual_ss);
    auto expected_str = expected_ss.str();
    auto actual_str = actual_ss.str();
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

    pugi::xml_document out;
    EncodeProgramTest(out, *program, param.input);

    ASSERT_TRUE(IsEqual(out, *param.expected));
}

INSTANTIATE_TEST_SUITE_P(DashQLStatement, GrammarParamTests,
                         testing::ValuesIn(GrammarParamTests::FindTests("dashql_statement.xml")), PrintTestName());
INSTANTIATE_TEST_SUITE_P(Demo, GrammarParamTests, testing::ValuesIn(GrammarParamTests::FindTests("scripts_demo.xml")),
                         PrintTestName());
INSTANTIATE_TEST_SUITE_P(SQLSelect, GrammarParamTests,
                         testing::ValuesIn(GrammarParamTests::FindTests("sql_select.xml")), PrintTestName());

}  // namespace

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
        if (p.path().extension().string() != ".xml") continue;

        // Open input stream
        std::ifstream in(p.path(), std::ios::in | std::ios::binary);
        if (!in) {
            std::cout << "[" << filename << "] failed to read file" << std::endl;
            continue;
        }

        // Parse xml document
        pugi::xml_document doc;
        doc.load(in);
        std::vector<GrammarParamTestsParam> tests;

        // Read tests
        for (auto test : doc.children()) {
            // Create test
            tests.emplace_back();
            auto& t = tests.back();
            t.name = test.attribute("name").as_string();
            t.input = test.child("input").last_child().value();

            auto expected = std::make_unique<pugi::xml_document>();
            for (auto s: test.child("expected").children()) {
                expected->append_copy(s);
            }
            t.expected = move(expected);
        }

        // Register test
        GrammarParamTests::tests.insert({filename, move(tests)});
    }

    testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
