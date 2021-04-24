// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_STMT_LOAD_STMT_H_
#define INCLUDE_DASHQL_ANALYZER_STMT_LOAD_STMT_H_

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
#include "dashql/parser/qualified_name.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

class LoadStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The AST index
    const ASTIndex ast_;
    /// The load method
    sx::LoadMethodType load_method_ = sx::LoadMethodType::NONE;
    /// The data source
    parser::QualifiedNameView data_source_ = {};

   public:
    /// Constructor
    LoadStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the target text
    sx::Location GetTarget() const;
    /// Print the options as json
    void PrintOptionsAsJSON(std::ostream& out, bool pretty = false) const;
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the load statement
    flatbuffers::Offset<proto::analyzer::LoadStatement> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<LoadStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
