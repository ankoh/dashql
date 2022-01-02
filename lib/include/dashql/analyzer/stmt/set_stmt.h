// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_STMT_SET_STMT_H_
#define INCLUDE_DASHQL_ANALYZER_STMT_SET_STMT_H_

#include <flatbuffers/flatbuffers.h>

#include <iostream>
#include <limits>
#include <optional>
#include <ostream>
#include <sstream>
#include <unordered_map>
#include <variant>

#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/enum.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"
#include "rapidjson/document.h"

namespace dashql {

class ProgramInstance;

class SetStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The schema map
    const ASTIndex ast_;

   public:
    /// Constructor
    SetStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the statement name
    std::string_view GetStatementName() const;
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Print the set statement as json
    void PrintAsJSON(std::ostream& out, bool pretty = false) const;
    /// Pack the load statement
    flatbuffers::Offset<proto::analyzer::SetStatement> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<SetStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
