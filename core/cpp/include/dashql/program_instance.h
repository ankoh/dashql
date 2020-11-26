// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_PROGRAM_INSTANCE_H_

#include <iostream>
#include <sstream>
#include <unordered_map>

#include "dashql/common/enum.h"
#include "dashql/proto/session_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "duckdb/web/webdb.h"

namespace dashql {

namespace sx = proto::syntax;

class ProgramInstance {
    /// The program text
    const std::string_view program_text_;
    /// The program
    const sx::ProgramT& program_;
    /// The parameters
    std::unordered_map<std::string_view, proto::session::ParameterValue> parameters_;
    /// The patch for partial evaluation (if any)
    std::unique_ptr<sx::ProgramPatchT> patch_;

    public:
    /// Constructor
    ProgramInstance(std::string_view text, const sx::ProgramT& program);

    /// Get the program text
    auto& program_text() const { return program_text_; }
    /// Get the program
    auto& program() const { return program_; }
    /// Get the parameters
    auto& parameters() const { return parameters_; }

    /// Evaluate the program partially
    void EvaluatePartially(duckdb::web::WebDB& database);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
