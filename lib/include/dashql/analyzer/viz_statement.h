// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_
#define INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_

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

namespace viz {

class VizComponent;
class VizAttributePrinter;

class VizStatement {
    friend class VizComponent;

   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The target
    const size_t target_node_id_;
    /// The components
    std::vector<std::unique_ptr<VizComponent>> components_ = {};
    /// The provided position.
    /// The owner of the position is the actual component.
    proto::analyzer::VizPosition* specified_position_ = nullptr;
    /// The computed position
    std::optional<proto::analyzer::VizPosition> computed_position_ = std::nullopt;
    /// The title
    std::optional<std::string_view> title_ = std::nullopt;
    /// The patches
    std::unordered_map<size_t, std::pair<sx::AttributeKey, rapidjson::Document>> patches_;

   public:
    /// Constructor
    VizStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the component
    auto& components() { return components_; }
    /// Get the specified position
    auto& specified_position() { return specified_position_; }
    /// Get the computed position
    auto& computed_position() { return computed_position_; }
    /// Get the title
    auto& title() { return title_; }
    /// Get the target node
    auto target_node_id() const { return target_node_id_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::analyzer::VizSpec> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<VizStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

using NodeID = uint32_t;
constexpr NodeID INVALID_NODE_ID = std::numeric_limits<NodeID>::max();

class VizComponent {
   protected:
    /// The unique properties
    VizStatement& viz_stmt_;
    /// The node id
    size_t node_id_;
    /// The type
    sx::VizComponentType type_ = sx::VizComponentType::TABLE;
    /// The type modifiers
    uint32_t type_modifiers_ = 0;
    /// The position (if any)
    std::optional<proto::analyzer::VizPosition> position_ = std::nullopt;
    /// The title (if any)
    std::optional<std::string> title_ = std::nullopt;

    /// Select an option
    bool AnyOptionSet(std::initializer_list<size_t> node_ids) const;
    /// Select an option with alternative
    size_t SelectAltOption(std::string_view label, size_t node_id, size_t alt_node_id) const;

   public:
    /// Constructor
    VizComponent(VizStatement& stmt, size_t node_id);
    /// Virtual destructor
    virtual ~VizComponent() = default;

    /// Get the viz statement
    auto& statement() const { return viz_stmt_; }
    /// Get the type
    auto& type() const { return type_; };
    /// Get the viz statement
    auto& position() { return position_; }

    /// Set the position
    void SetPosition(dashql::proto::analyzer::VizPosition pos) { position_ = pos; }
    /// Clear the position (if any)
    void ClearPosition() { position_.reset(); }
    /// Read the viz component
    /// This will also perform a semanatic analysis of the given options
    void ReadFrom(size_t node_id);
    /// Print common attributes
    void PrintAttributes(VizAttributePrinter& out) const;

    /// Print the options as json
    void PrintOptionsAsJSON(std::ostream& out, bool pretty = false) const;
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack as buffer
    flatbuffers::Offset<proto::analyzer::VizComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Read component from a node
    static std::unique_ptr<VizComponent> CreateFrom(VizStatement& stmt, size_t node_id);
};

}  // namespace viz
}  // namespace dashql

#endif