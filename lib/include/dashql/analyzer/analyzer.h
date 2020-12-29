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
namespace sxs = proto::syntax_sql;

struct ConstantValue {
    /// The constant type
    sxs::AConstType constant_type;
    /// The value
    std::variant<std::monostate, bool, int64_t, double, std::string_view> value;

    /// Constructor
    ConstantValue();
    /// Constructor
    ConstantValue(sxs::AConstType type, bool value);
    /// Constructor
    ConstantValue(sxs::AConstType type, int64_t value);
    /// Constructor
    ConstantValue(sxs::AConstType type, double value);
    /// Constructor
    ConstantValue(sxs::AConstType type, std::string_view value);
};

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
    std::optional<ConstantValue> TryEvaluateConstant(ProgramInstance& instance, const sx::Node& node) const;
    /// Evaluate the program
    Signal EvaluateProgram(ProgramInstance& instance);

   public:
    /// Constructor
    Analyzer();

    /// Parse a program
    ExpectedBuffer<proto::syntax::Program> ParseProgram(std::string_view text);
    /// Instantiate the last program
    Signal InstantiateProgram(proto::analyzer::ProgramParametersT& params);
    /// Plan the last program
    ExpectedBuffer<proto::analyzer::Plan> PlanProgram();

    /// Get the global analyzer instance
    static Analyzer& GetInstance();
    /// Reset the global analyzer instance
    static void ResetInstance();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_ANALYZER_H_
