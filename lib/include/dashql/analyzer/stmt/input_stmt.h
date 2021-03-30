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
    /// The target
    const size_t target_node_id_;
    /// The specified position
    std::optional<proto::analyzer::CardPosition> specified_position_ = std::nullopt;
    /// The title
    std::optional<std::string_view> title_ = std::nullopt;
    /// The patches
    std::unordered_map<size_t, std::pair<sx::AttributeKey, rapidjson::Document>> patches_;

   public:
    /// Constructor
    InputStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the specified position
    auto& specified_position() { return specified_position_; }
    /// Get the title
    auto& title() { return title_; }
    /// Get the target node
    auto target_node_id() const { return target_node_id_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::analyzer::Card> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<InputStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

}  // namespace dashql

#endif
