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

#include "dashql/analyzer/input_value.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/common/raw_buffer.h"
#include "dashql/proto_generated.h"

namespace dashql {

using TaskGraph = proto::task::TaskGraph;
using Plan = proto::analyzer::Plan;
using Program = proto::syntax::Program;
using RawBuffer = dashql::RawBuffer;

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
    std::unique_ptr<proto::task::TaskGraphT> planned_graph_;

    /// Evaluate the constant
    arrow::Result<std::shared_ptr<arrow::Scalar>> TryEvaluateConstant(ProgramInstance& instance, size_t node_id) const;
    /// Evaluate constants
    arrow::Result<std::shared_ptr<arrow::Scalar>> TryEvaluateFunctionCall(ProgramInstance& instance,
                                                                          size_t node_id) const;
    /// Evaluate the given parameter values
    arrow::Status EvaluateInputValues(ProgramInstance& instance);
    /// Evaluate constants
    arrow::Status PropagateConstants(ProgramInstance& instance);
    /// Identify all statements that do not contribute to a viz
    arrow::Status IdentifyDeadStatements(ProgramInstance& instance);
    /// Analyze input statements
    arrow::Status AnalyzeInputStatements(ProgramInstance& instance);
    /// Analyze fetch statements
    arrow::Status AnalyzeFetchStatements(ProgramInstance& instance);
    /// Analyze set statements
    arrow::Status AnalyzeSetStatements(ProgramInstance& instance);
    /// Analyze load statements
    arrow::Status AnalyzeLoadStatements(ProgramInstance& instance);
    /// Analyze viz statements
    arrow::Status AnalyzeVizStatements(ProgramInstance& instance);
    /// Compute the card positions
    arrow::Status ComputeCardPositions(ProgramInstance& instance);

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

    /// Update the task status
    arrow::Status UpdateTaskStatus(proto::task::TaskClass task_class, size_t task_id,
                                   proto::task::TaskStatusCode status);

    /// Parse a program
    arrow::Status ParseProgram(std::string_view text);
    /// Instantiate the last program
    arrow::Status InstantiateProgram(std::vector<InputValue> params);
    /// Edit the last program
    arrow::Status EditProgram(const proto::edit::ProgramEdit& edit);
    /// Plan the last program
    arrow::Status PlanProgram();

    /// Pack the program
    arrow::Result<flatbuffers::Offset<proto::syntax::Program>> PackProgram(flatbuffers::FlatBufferBuilder& builder);
    /// Pack the program annotations
    arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramAnnotations>> PackProgramAnnotations(
        flatbuffers::FlatBufferBuilder& builder);
    /// Pack the plan
    arrow::Result<flatbuffers::Offset<proto::analyzer::Plan>> PackPlan(flatbuffers::FlatBufferBuilder& builder);
    /// Pack a program replacement
    arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramReplacement>> PackReplacement(
        flatbuffers::FlatBufferBuilder& builder);

    /// Get the global analyzer instance
    static Analyzer& GetInstance();
    /// Reset the global analyzer instance
    static void ResetInstance();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_ANALYZER_H_
