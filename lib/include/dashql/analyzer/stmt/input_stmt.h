// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_STMT_INPUT_STMT_H_
#define INCLUDE_DASHQL_ANALYZER_STMT_INPUT_STMT_H_

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

class InputStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The schema map
    const ASTIndex ast_;
    /// The value type
    proto::sql::SQLType value_type_ = proto::sql::SQLType();
    /// The component type
    std::optional<sx::InputComponentType> component_type_ = std::nullopt;
    /// The position option
    std::optional<proto::analyzer::CardPosition> specified_position_ = std::nullopt;
    /// The computed position
    std::optional<proto::analyzer::CardPosition> computed_position_ = std::nullopt;
    /// The title
    std::optional<std::string> title_ = std::nullopt;

   public:
    /// Constructor
    InputStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast);
    /// Get the statement id
    auto& statement_id() { return statement_id_; }
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the component type
    auto& component_type() { return component_type_; }
    /// Get the specified position
    auto& specified_position() { return specified_position_; }
    /// Get the computed position
    auto& computed_position() { return computed_position_; }
    /// Get the title
    auto& title() { return title_; }
    /// Get the statement name
    std::string_view GetStatementName() const;
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::analyzer::Card> PackCard(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<InputStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
