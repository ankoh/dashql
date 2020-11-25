#include "dashql/action_planner.h"

namespace dashql {

// Constructor
ActionPlanner::ActionPlanner(std::string_view next_program_text, const sx::Program& next_program, std::string_view prev_program_text, const proto::session::Plan* prev_plan, const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status)
    : next_program_text_(next_program_text), next_program_(next_program), prev_program_text_(prev_program_text), prev_plan_(prev_plan), prev_action_status_(prev_status), diff_(), setup_actions_(), graph_actions_(), graph_sources_() {}

// Translate a load statement
proto::action::ActionT TranslateLoad(const sx::Statement& stmt) {
}

// Translate an extract statement
proto::action::ActionT TranslateExtract(const sx::Statement& stmt) {
}

// Translate a viz statement
proto::action::ActionT TranslateViz(const sx::Statement& stmt) {
}

// Translate a parameter statement
proto::action::ActionT TranslateParameter(const sx::Statement& stmt) {
}

// Translate a sql statement
proto::action::ActionT TranslateSQL(const sx::Statement& stmt) {
}

// Diff programs
void ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as INSERT
    if (!prev_plan_) {
        for (unsigned i = 0; i < next_program_.statements()->size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return;
    }

    // Compute the patience diff
    auto& prev_program = *prev_plan_->program();
    ProgramMatcher matcher{prev_program_text_, next_program_text_, prev_program, next_program_};
    diff_ = matcher.ComputeDiff();
}

// Translate program canonically
void ActionPlanner::TranslateProgramCanconically() {
    auto& stmts = *next_program_.statements();
    graph_actions_.resize(stmts.size());

    // Translate statements to actions as if there all statements were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        auto& stmt = *stmts.Get(stmt_id);
        auto& action = graph_actions_[stmt_id];
        switch (next_program_.nodes()->Get(stmt.root())->node_type()) {
            case sx::NodeType::OBJECT_DASHQL_QUERY:
                action = TranslateSQL(stmt);
                break;
            case sx::NodeType::OBJECT_DASHQL_VIZ:
                action = TranslateViz(stmt);
                break;
            case sx::NodeType::OBJECT_DASHQL_LOAD:
                action = TranslateLoad(stmt);
                break;
            case sx::NodeType::OBJECT_DASHQL_EXTRACT:
                action = TranslateExtract(stmt);
                break;
            case sx::NodeType::OBJECT_DASHQL_PARAMETER:
                action = TranslateParameter(stmt);
                break;
            default:
                // Failed to map the root node of a statement to an action
                assert(false);
        }
    }

    // Store dependencies
    auto& deps = *next_program_.dependencies();
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = *deps.Get(dep_id);
        graph_actions_[dep.source_statement()].required_for.push_back(dep.target_statement());
        graph_actions_[dep.target_statement()].depends_on.push_back(dep.source_statement());
    }
}

void ActionPlanner::MapCompletedActions() {
    // TODO
}

void ActionPlanner::PropagateUpdates() {
    // TODO
}


// Plan the new action graph
void ActionPlanner::PlanActionGraph() {
    DiffPrograms();
    TranslateProgramCanconically();
    MapCompletedActions();
    PropagateUpdates();
}

// Encode action graph
flatbuffers::Offset<proto::action::ActionGraph> ActionPlanner::EncodeActionGraph(flatbuffers::FlatBufferBuilder& builder) {
    // Pack setup actions
    std::vector<flatbuffers::Offset<proto::action::Action>> setup_actions;
    for (auto a: setup_actions_) {
        setup_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    // Pack the graph actions
    auto setup_actions_vec = builder.CreateVector(setup_actions);
    std::vector<flatbuffers::Offset<proto::action::Action>> graph_actions;
    for (auto a: graph_actions_) {
        graph_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    auto graph_actions_vec = builder.CreateVector(graph_actions);
    auto sources = builder.CreateVector(graph_sources_);
    // Build the graph
    proto::action::ActionGraphBuilder graph{builder};
    graph.add_setup(setup_actions_vec);
    graph.add_graph_actions(graph_actions_vec);
    graph.add_graph_sources(sources);
    return graph.Finish();
}

}
