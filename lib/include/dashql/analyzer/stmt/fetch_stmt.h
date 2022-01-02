// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_STMT_FETCH_STMT_H_
#define INCLUDE_DASHQL_ANALYZER_STMT_FETCH_STMT_H_

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

namespace dashql {

class FetchStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The AST index
    const ASTIndex ast_;

    /// The method
    sx::FetchMethodType method_ = sx::FetchMethodType::NONE;
    /// The url
    std::string url_ = "";

   public:
    /// Constructor
    FetchStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the target text
    sx::Location GetTarget() const;
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Print the extra config as json
    void PrintExtraAsJSON(std::ostream& out, bool pretty = false) const;
    /// Pack the load statement
    flatbuffers::Offset<proto::analyzer::FetchStatement> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a statement
    static std::unique_ptr<FetchStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
