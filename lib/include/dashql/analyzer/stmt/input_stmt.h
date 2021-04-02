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

#include "dashql/common/enum.h"
#include "dashql/common/span.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"

namespace sx = dashql::proto::syntax;

namespace dashql {

class ProgramInstance;

class InputStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The id statement name node
    const size_t statement_name_node_;
    /// The id of the value type node
    const size_t type_node_;
    /// The value type
    duckdb::web::proto::SQLType value_type_ = duckdb::web::proto::SQLType();
    /// The component type
    std::optional<sx::InputComponentType> component_type_ = std::nullopt;
    /// The position option
    std::optional<proto::analyzer::CardPosition> position_ = std::nullopt;
    /// The title
    std::optional<std::string> title_ = std::nullopt;
    /// The patches
    std::unordered_map<size_t, std::pair<sx::AttributeKey, rapidjson::Document>> patches_;

   public:
    /// Constructor
    InputStatement(ProgramInstance& instance, size_t statement_id, size_t statement_name_node, size_t type_node);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the statement name
    auto& statement_name_node() { return statement_name_node_; }
    /// Get the component type
    auto& component_type() { return component_type_; }
    /// Get the specified position
    auto& position() { return position_; }
    /// Get the title
    auto& title() { return title_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::analyzer::Card> PackCard(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<InputStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
