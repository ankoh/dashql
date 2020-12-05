// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTS_H_
#define INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTS_H_

#include <filesystem>
#include <string>
#include <unordered_map>

#include "gtest/gtest.h"
#include "dashql/proto_generated.h"
#include "pugixml.hpp"

namespace dashql {
namespace test {

struct GrammarTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const GrammarTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The input
    std::string input;
    /// The expected output
    pugi::xml_document expected;

    /// Matches the expected output?
    ::testing::AssertionResult Matches(const pugi::xml_node& actual) const;

    /// Encode a program
    static void EncodeProgram(pugi::xml_node& root, const proto::syntax::ProgramT& program, std::string_view text);
    /// Get the grammar tests
    static void LoadTests(std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const GrammarTest*> GetTests(std::string_view filename);
    
};

}  // namespace test
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTS_H_
