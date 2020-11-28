#include "dashql/test/action_test_encoder.h"

#include <cstdint>
#include <iostream>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "c4/yml/std/string.hpp"
#include "c4/yml/yml.hpp"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"
#include "ryml.hpp"
#include "ryml_std.hpp"

namespace dashql {
namespace parser {

void EncodeActionTest(ryml::NodeRef root, const ProgramInstance& program, const proto::action::ActionGraphT* graph) {
//    auto& tree = *root.tree();
//    root |= ryml::MAP;

}

}  // namespace parser
}  // namespace dashql
