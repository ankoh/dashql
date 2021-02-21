// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_
#define INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_

#include <flatbuffers/flatbuffers.h>
#include <iostream>
#include <optional>
#include <ostream>
#include <sstream>
#include <unordered_map>
#include <variant>

#include "dashql/common/enum.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace sx = dashql::proto::syntax;

namespace dashql {

class ProgramInstance;

namespace viz {

class VizComponent;
class VizAttributePrinter;

class VizStatement {
   protected:
    /// The program instance
    const ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The target
    const sx::Node& target_;
    /// The components
    std::vector<std::unique_ptr<VizComponent>> components_ = {};

    /// The position (if known)
    std::optional<dashql::proto::viz::VizPosition> position_ = std::nullopt;
 
   public:
    /// Constructor
    VizStatement(const ProgramInstance& instance, size_t statement_id, const sx::Node& target, std::vector<std::unique_ptr<VizComponent>>&& components);
    /// Get the component
    auto& components() { return components_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::viz::VizSpec> Pack(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<VizStatement> ReadFrom(const ProgramInstance& instance,
                                                  size_t statement_id);
};

class VizComponent {
   protected:
    /// The position
    std::optional<dashql::proto::viz::VizPosition> position = std::nullopt;

   public:
    /// Virtual destructor
    virtual ~VizComponent() = default;

    /// Set the position
    void SetPosition(dashql::proto::viz::VizPosition tile) { position = tile; }
    /// Clear the position (if any)
    void ClearPosition() { position.reset(); }
    /// Read attributes of the viz component
    void ReadAttributes(const ProgramInstance& instance, const sx::Node& node);
    /// Print common attributes
    void PrintAttributes(VizAttributePrinter& out) const;

    /// Print as script
    virtual void PrintScript(std::ostream& out) const = 0;
    /// Pack as buffer
    virtual flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const = 0;
    /// Read component from a node
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

struct TableChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Pack flatbuffer
    flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A line chart component
struct LineChartComponent : public VizComponent {
    /// Is stacked?
    bool stacked = false;

    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Pack as buffer
    flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};


/// A scatter chart component
struct ScatterChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Pack as buffer
    flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A line chart component
struct AreaChartComponent : public VizComponent {
    /// Is stacked?
    bool stacked = false;

    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Pack as buffer
    flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A line chart component
struct AxisComponent : public VizComponent {
    /// Is dependant axis?
    bool dependant = false;

    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Pack as buffer
    flatbuffers::Offset<proto::viz::ChartComponent> Pack(flatbuffers::FlatBufferBuilder& builder) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

}  // namespace viz
}  // namespace dashql

#endif