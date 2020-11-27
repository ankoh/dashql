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

void EncodeActionTest(ryml::NodeRef ref, const ProgramInstance& next, const ProgramInstance* prev,
                      const proto::action::ActionGraphT* prev_graph) {
    
}

}  // namespace parser
}  // namespace dashql
