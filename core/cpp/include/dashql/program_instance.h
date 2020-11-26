// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_PROGRAM_INSTANCE_H_

#include <iostream>
#include <sstream>
#include <unordered_map>

#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
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

    /// Get the text at a location
    std::string_view TextAt(sx::Location loc) const { return program_text_.substr(loc.offset(), loc.length()); }
    /// Evaluate the program partially
    Signal EvaluatePartially(duckdb::web::WebDB& database);
    /// Render the statement text
    Expected<std::string> RenderStatementText(size_t stmt_id) const;
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
