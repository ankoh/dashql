// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include "dashql/program_diff.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_generated.h"

namespace dashql {

/// The action planner
class ActionPlanner {
   protected:
    /// The program text
    std::string_view program_text_;
    /// The program
    const proto::syntax::Program& program_;
    /// The program matcher
    ProgramMatcher matcher_;

   public:
    /// Constructor
    ActionPlanner(std::string_view program_text, proto::syntax::Program& program);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
