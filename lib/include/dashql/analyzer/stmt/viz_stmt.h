// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_STMT_VIZ_STMT_H_
#define INCLUDE_DASHQL_ANALYZER_STMT_VIZ_STMT_H_

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
#include "rapidjson/document.h"

namespace dashql {

class ProgramInstance;

class VizComponent;
class VizAttributePrinter;

class VizStatement {
    friend class VizComponent;

   protected:
    /// The program instance
    ProgramInstance& instance_;
    /// The statement id
    const size_t statement_id_;
    /// The AST index
    const ASTIndex ast_;
    /// The target
    parser::QualifiedNameView target_ = {};
    /// The components
    std::vector<std::unique_ptr<VizComponent>> components_;
    /// The provided position.
    /// The owner of the position is the actual component.
    proto::analyzer::CardPosition* specified_position_ = nullptr;
    /// The computed position
    std::optional<proto::analyzer::CardPosition> computed_position_ = std::nullopt;
    /// The title
    std::optional<std::string> title_ = std::nullopt;
    /// The patches
    std::unordered_map<size_t, std::pair<sx::AttributeKey, rapidjson::Document>> patches_;

   public:
    /// Constructor
    VizStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast);
    /// Get the instance
    auto& instance() { return instance_; }
    /// Get the target text
    auto& target() const { return target_; };
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the component
    auto& components() { return components_; }
    /// Get the specified position
    auto& specified_position() { return specified_position_; }
    /// Get the computed position
    auto& computed_position() { return computed_position_; }
    /// Get the title
    auto& title() { return title_; }
    /// Print as script
    void PrintScript(std::ostream& out) const;
    /// Pack the viz specs
    flatbuffers::Offset<proto::analyzer::Card> PackCard(flatbuffers::FlatBufferBuilder& builder) const;

    /// Read a viz statement
    static std::unique_ptr<VizStatement> ReadFrom(ProgramInstance& instance, size_t statement_id);
};

class VizComponent {
   protected:
    /// The unique properties
    VizStatement& viz_stmt_;
    /// The node id
    size_t node_id_;
    /// The AST index
    const ASTIndex ast_;
    /// The type
    sx::VizComponentType type_ = sx::VizComponentType::TABLE;
    /// The type modifiers
    uint32_t type_modifiers_ = 0;
    /// The position (if any)
    std::optional<proto::analyzer::CardPosition> position_ = std::nullopt;
    /// The title (if any)
    std::optional<std::string> title_ = std::nullopt;

   public:
    /// Constructor
    VizComponent(VizStatement& stmt, size_t node_id, ASTIndex ast);
    /// Virtual destructor
    virtual ~VizComponent() = default;

    /// Get the viz statement
    auto& statement() const { return viz_stmt_; }
    /// Get the ast
    auto& ast() { return ast_; }
    /// Get the type
    auto& type() const { return type_; };
    /// Get the viz statement
    auto& position() { return position_; }

    /// Set the position
    void SetPosition(dashql::proto::analyzer::CardPosition pos) { position_ = pos; }
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
    static std::unique_ptr<VizComponent> ReadFrom(VizStatement& stmt, size_t node_id);
};

}  // namespace dashql

#endif
