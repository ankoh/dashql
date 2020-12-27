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
using Plan = proto::session::Plan;
using Program = proto::syntax::Program;
using RawBuffer = dashql::RawBuffer;

namespace fb = flatbuffers;

class Analyzer {
   protected:
    /// The volatile program text (if any)
    std::shared_ptr<std::string> volatile_program_text_;
    /// The volatile program text (if any)
    std::shared_ptr<proto::syntax::ProgramT> volatile_program_;

    /// The planned program (if any)
    std::unique_ptr<ProgramInstance> planned_program_;
    /// The planned graph (if any)
    std::unique_ptr<proto::action::ActionGraphT> planned_graph_;
    /// The planner log
    std::vector<std::unique_ptr<ProgramInstance>> planner_log_;
    /// The planner log writer cursor
    size_t planner_log_writer_;

   public:
    /// Constructor
    Analyzer();

    /// Parse a program
    ExpectedBuffer<proto::syntax::Program> ParseProgram(std::string_view text);
    /// Plan the last program
    ExpectedBuffer<proto::session::Plan> PlanProgram(proto::session::PlanArgumentsT& args);

    /// Get the global analyzer instance
    static Analyzer& GetInstance();
    /// Reset the global analyzer instance
    static void ResetInstance();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_ANALYZER_H_
