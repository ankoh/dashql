// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_ANALYZER_H_
#define INCLUDE_DASHQL_ANALYZER_ANALYZER_H_

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

#include "dashql/analyzer/program_instance.h"
#include "dashql/common/blob_stream.h"
#include "dashql/common/expected.h"
#include "dashql/common/raw_buffer.h"
#include "dashql/proto_generated.h"

namespace dashql {

using ActionGraph = proto::action::ActionGraph;
using Plan = proto::analyzer::Plan;
using Program = proto::syntax::Program;
using RawBuffer = dashql::RawBuffer;

namespace fb = flatbuffers;

class Analyzer {
   protected:
    /// The volatile program text (if any)
    std::shared_ptr<std::string> volatile_program_text_;
    /// The volatile program text (if any)
    std::shared_ptr<proto::syntax::ProgramT> volatile_program_;

    /// The program instance (if any)
    std::unique_ptr<ProgramInstance> program_instance_;
    /// The program log
    std::vector<std::unique_ptr<ProgramInstance>> program_log_;
    /// The planner log writer cursor
    size_t program_log_writer_;

    /// The planned program
    const ProgramInstance* planned_program_;
    /// The planned graph (if any)
    std::unique_ptr<proto::action::ActionGraphT> planned_graph_;

    /// Evaluate the constant
    std::optional<Value> TryEvaluateConstant(ProgramInstance& instance, size_t node_id) const;
    /// Evaluate the given parameter values
    void EvaluateParameterValues(ProgramInstance& instance);
    /// Propagate the given parameter values
    void PropagateParameterValues(ProgramInstance& instance);

   public:
    /// Constructor
    Analyzer();

    /// Get the volatile program
    auto volatile_program() const { return volatile_program_.get(); }
    /// Get the current program instance
    auto program_instance() const { return program_instance_.get(); }
    /// Get the planned program instance
    auto planned_program_instance() const { return planned_program_; }
    /// Get the planned graph
    auto planned_graph() const { return planned_graph_.get(); }

    /// Update the setup action status
    void UpdateSetupActionStatus(size_t action_id, proto::action::ActionStatusCode status);
    /// Update the program action status
    void UpdateProgramActionStatus(size_t action_id, proto::action::ActionStatusCode status);

    /// Parse a program
    Signal ParseProgram(std::string_view text);
    /// Instantiate the last program
    Signal InstantiateProgram(std::vector<ProgramInstance::ParameterValue> params);
    /// Plan the last program
    Signal PlanProgram();

    /// Pack the program
    flatbuffers::Offset<proto::syntax::Program> PackProgram(flatbuffers::FlatBufferBuilder& builder);
    /// Pack the plan
    flatbuffers::Offset<proto::analyzer::Plan> PackPlan(flatbuffers::FlatBufferBuilder& builder);

    /// Get the global analyzer instance
    static Analyzer& GetInstance();
    /// Reset the global analyzer instance
    static void ResetInstance();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_ANALYZER_H_
