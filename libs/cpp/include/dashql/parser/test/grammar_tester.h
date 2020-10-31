// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTER_H_
#define INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTER_H_

#include <string>
#include "ryml_std.hpp"
#include "ryml.hpp"
#include "dashql/parser/proto/syntax_generated.h"

namespace dashql {
namespace parser {

class GrammarTester {
    public:
    /// Encode the expectation
    static void EncodeExpect(ryml::NodeRef ref, const proto::syntax::Module& module, std::string_view text);
};

/// Encode yaml string

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_TEST_GRAMMAR_TESTER_H_
