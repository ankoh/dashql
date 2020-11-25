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
    /// The next program text
    const std::string_view next_program_text_;
    /// The next program
    const sx::Program& next_program_;
    /// The previous plan (if any)
    const std::string_view prev_program_text_;
    /// The previous plan (if any)
    const proto::session::Plan* prev_plan_;
    /// The previous action status
    const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The setup actions
    std::vector<proto::action::ActionT> setup_actions_;
    /// The graph actions
    std::vector<proto::action::ActionT> graph_actions_;
    /// The graph sources
    std::vector<uint32_t> graph_sources_;

    /// Translate a load statement
    proto::action::ActionT TranslateLoad(const sx::Statement& stmt);
    /// Translate an extract statement
    proto::action::ActionT TranslateExtract(const sx::Statement& stmt);
    /// Translate a viz statement
    proto::action::ActionT TranslateViz(const sx::Statement& stmt);
    /// Translate a parameter statement
    proto::action::ActionT TranslateParameter(const sx::Statement& stmt);
    /// Translate a sql statement
    proto::action::ActionT TranslateSQL(const sx::Statement& stmt);

    /// Diff the two programs
    void DiffPrograms();
    /// Translate program canonically
    void TranslateProgramCanconically();
    /// Map the completed actions
    void MapCompletedActions();
    /// Invalidate the updates through the graph
    void PropagateUpdates();

  public:
    /// Constructor
    ActionPlanner(std::string_view next_program_text, const sx::Program& next_program, std::string_view prev_program_text, const proto::session::Plan* prev_plan, const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status);

    /// Plan the new action graph
    void PlanActionGraph();
    /// Encode action graph
    flatbuffers::Offset<proto::action::ActionGraph> EncodeActionGraph(flatbuffers::FlatBufferBuilder& builder);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ACTION_PLANNER_H_
