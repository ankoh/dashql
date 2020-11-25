// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include <unordered_map>
#include "dashql/program_diff.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_generated.h"

namespace dashql {

/// The action planner
class ActionPlanner {
   protected:
    /// The previous plan
    const proto::session::Plan* current_plan_;
    /// The current action status
    std::unordered_map<uint32_t, proto::action::ActionStatus> current_action_status_;
    /// The program matcher
    ProgramMatcher matcher_;
    /// Create new action
    std::vector<proto::action::ActionT> actions_;
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
