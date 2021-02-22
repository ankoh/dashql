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

namespace sx = dashql::proto::syntax;
namespace pv = dashql::proto::viz;

namespace dashql {

class ProgramInstance;

namespace viz {

class VizComponent;
class VizAttributePrinter;

class VizStatement {
   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The target
    const size_t target_node_id_;
    /// The components
    std::vector<std::unique_ptr<VizComponent>> components_ = {};

    /// The position (if known)
    std::optional<dashql::proto::viz::VizPosition> position_ = std::nullopt;

   public:
    /// Constructor
    VizStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id,
                 std::vector<std::unique_ptr<VizComponent>>&& components);
    /// Get the component
    auto& components() { return components_; }
    /// Get the target node
    auto target_node_id() const { return target_node_id_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::viz::VizSpec> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<VizStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

using NodeID = uint32_t;
constexpr NodeID INVALID_NODE_ID = std::numeric_limits<NodeID>::max();

class VizComponent {
   protected:
    /// The program instance
    ProgramInstance& instance;
    /// The type
    sx::VizComponentType type_ = sx::VizComponentType::TABLE;
    /// The type modifiers
    uint32_t type_modifiers_ = 0;
    /// The position option
    std::optional<pv::VizPosition> position_ = std::nullopt;
    /// The chart data option
    std::optional<pv::VizDataT> data_ = std::nullopt;
    /// The style option
    std::vector<pv::SVGStyleProperty> style_ = {};
    /// The domain option
    std::optional<pv::VizDomain> domain_ = std::nullopt;
    /// The origin option
    std::optional<pv::Coordinates> origin_ = std::nullopt;
    /// The padding option
    std::optional<pv::VizPadding> padding_ = std::nullopt;
    /// The scales option
    std::optional<pv::VizScales> scales_ = std::nullopt;
    /// The name option
    NodeID name_ = INVALID_NODE_ID;
    /// THe samples option
    NodeID samples_ = INVALID_NODE_ID;
    /// The theme option
    NodeID theme_ = INVALID_NODE_ID;
    /// The interpolation option
    NodeID interpolation_ = INVALID_NODE_ID;

   protected:
    /// Any option set?
    bool AnyOptionSet(std::initializer_list<size_t> node_ids) const;
    /// Select among matches and report ambiguities (if any)
    size_t SelectAltOption(std::string_view label, size_t node_id, size_t alt_node_id) const;
    /// Match an alternative style option
    void AddAltStyleOption(std::string_view label, size_t node_id, dashql::proto::viz::SVGStylePropertyType prop, std::vector<pv::SVGStyleProperty>& out) const;

   public:
    /// Constructor
    VizComponent(ProgramInstance& instance);
    /// Virtual destructor
    virtual ~VizComponent() = default;

    /// Get the type
    auto type() const { return type_; };
    /// Get the position
    auto position() const { return position_; };
    /// Get the data
    auto data() const { return data_; };

    /// Set the position
    void SetPosition(dashql::proto::viz::VizPosition tile) { position_ = tile; }
    /// Clear the position (if any)
    void ClearPosition() { position_.reset(); }
    /// Read the viz component
    /// This will also perform a semanatic analysis of the given options
    void ReadFrom(size_t node_id);
    /// Print common attributes
    void PrintAttributes(VizAttributePrinter& out) const;

    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack as buffer
    flatbuffers::Offset<proto::viz::VizComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Read component from a node
    static std::unique_ptr<VizComponent> CreateFrom(ProgramInstance& instance, size_t node_id);
};

}  // namespace viz
}  // namespace dashql

#endif