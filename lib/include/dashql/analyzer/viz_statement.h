// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_
#define INCLUDE_DASHQL_ANALYZER_VIZ_STATMENT_H_

#include <iostream>
#include <optional>
#include <sstream>
#include <unordered_map>
#include <variant>

#include "dashql/analyzer/program_instance.h"
#include "dashql/common/enum.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace viz {

struct VizComponent;

class VizStatement {
   protected:
    /// The program instance
    const ProgramInstance& instance_;
    /// The node
    const sx::Node& node_;
    /// The target
    const sx::Node& target_;
    /// The components
    std::vector<std::unique_ptr<VizComponent>> components_ = {};
 
   public:
    /// Constructor
    VizStatement(const ProgramInstance& instance, const sx::Node& node, const sx::Node& target, std::vector<std::unique_ptr<VizComponent>>&& components);
    /// Get the component
    auto& components() { return components_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::viz::VizSpec> Pack(flatbuffers::FlatBufferBuilder& builder);

    /// Read a viz statement
    static std::unique_ptr<VizStatement> ReadFrom(const ProgramInstance& instance,
                                                  const proto::syntax::StatementT& statement);
};

class VizComponent {
   protected:
    /// The position
    std::optional<dashql::proto::viz::VizTile> position_ = std::nullopt;

   public:
    /// Constructor
    VizComponent();
    /// Virtual destructor
    virtual ~VizComponent() = default;

    /// Set the position
    void SetPosition(dashql::proto::viz::VizTile tile) { position_ = tile; }
    /// Clear the position (if any)
    void ClearPosition() { position_.reset(); }

    /// Read attributes from a node span
    virtual void ReadAttributes(const ProgramInstance& instance, const sx::Node& node) = 0;
    /// Print as script
    virtual void PrintScript(std::ostream& out) const = 0;

    /// Read component from a node
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

class TableChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A line chart component
class LineChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A scatter chart component
class ScatterChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

/// A line chart component
class AreaChartComponent : public VizComponent {
    /// Print as script
    void PrintScript(std::ostream& out) const override;
    /// Read attributes
    static std::unique_ptr<VizComponent> ReadFrom(const ProgramInstance& instance, const sx::Node& node);
};

}  // namespace viz
}  // namespace dashql

#endif