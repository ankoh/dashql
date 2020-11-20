// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ACTION_PLANNER_H_
#define INCLUDE_DASHQL_ACTION_PLANNER_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "dashql/common/expected.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"

namespace dashql {

namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
namespace sxs = proto::syntax_sql;
namespace fb = flatbuffers;
namespace ac = proto::action;

class ActionPlanner {
    protected:
    /// The current program
    std::pair<sx::Program*, fb::DetachedBuffer> program;
    /// The action graph
    std::pair<ac::ActionGraph*, fb::DetachedBuffer> action_graph_buffer_;
    /// The current action status
    std::unordered_map<uint32_t, ac::ActionStatus> action_status;


    public:
    /// Constructor
    ActionPlanner();

    /// Plan a new program
    Expected<ac::ActionGraph*> Plan(sx::Program* new_program, fb::DetachedBuffer&& buffer);
    /// Update the action status
    void SetStatus(uint32_t id, ac::ActionStatus status);
};


}

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
