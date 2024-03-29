// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"

#include <iostream>
#include <regex>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

#include "dashql/common/error.h"
#include "dashql/common/hash.h"
#include "dashql/common/string.h"
#include "dashql/common/variant.h"
#include "dashql/parser/grammar/nodes.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/qualified_name.h"
#include "dashql/parser/scanner.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

/// Printing locations
std::ostream& operator<<(std::ostream& out, const Location& loc) {
    out << "[" << loc.offset() << "," << (loc.offset() + loc.length()) << "[";
    return out;
}

/// Syntactic sugar to set the key of a node
sx::Node operator<<(uint16_t key, const sx::Node& node) {
    return sx::Node(node.location(), node.node_type(), key, node.parent(), node.children_begin_or_value(),
                    node.children_count());
}

/// Syntactic sugar to set the key of a node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node) {
    return sx::Node(node.location(), node.node_type(), static_cast<uint16_t>(key), node.parent(),
                    node.children_begin_or_value(), node.children_count());
}

/// Syntactic sugar concatenate vectors
NodeVector& operator<<(NodeVector& attrs, const sx::Node& node) {
    attrs.push_back(node);
    return attrs;
}

/// Concatenate 2 vectors
NodeVector concat(NodeVector&& l, NodeVector&& r) {
    for (auto& node : r) {
        l.push_back(node);
    }
    return l;
}

/// Concatenate 3 vectors
NodeVector concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2) {
    v0.reserve(v0.size() + v1.size() + v2.size());
    for (auto& n : v1) {
        v0.push_back(n);
    }
    for (auto& n : v2) {
        v0.push_back(n);
    }
    return v0;
}

/// Concatenate 4 vectors
NodeVector concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2, NodeVector&& v3) {
    v0.reserve(v0.size() + v1.size() + v2.size() + v3.size());
    for (auto& n : v1) {
        v0.push_back(n);
    }
    for (auto& n : v2) {
        v0.push_back(n);
    }
    for (auto& n : v3) {
        v0.push_back(n);
    }
    return v0;
}

/// Constructor
Statement::Statement() : root(), name(), table_refs(), column_refs() {}

/// Reset the statement
void Statement::reset() {
    root = std::numeric_limits<uint32_t>::max();
    name = {};
    table_refs = {};
    column_refs = {};
}

/// Finish a statement
std::unique_ptr<sx::StatementT> Statement::Finish() {
    auto stmt = std::make_unique<sx::StatementT>();
    stmt->statement_type = type;
    stmt->root_node = root;
    stmt->name_qualified = name.ToString();
    stmt->name_pretty = name.ToPrettyString();
    return stmt;
}

/// Constructor
ParserDriver::ParserDriver(Scanner& scanner)
    : scanner_(scanner),
      options_(),
      nodes_(),
      current_statement_(),
      statements_(),
      dependencies_(),
      errors_(),
      dson_keys_(),
      dson_key_map_() {}

/// Destructor
ParserDriver::~ParserDriver() {}

/// Find an attribute
std::optional<size_t> ParserDriver::FindAttribute(const sx::Node& node, Key attribute) const {
    auto attr_begin = node.children_begin_or_value();
    auto attr_count = node.children_count();
    for (auto i = 0; i < attr_count; ++i) {
        auto& attr = nodes_[attr_begin + i];
        if (attr.attribute_key() == static_cast<uint16_t>(attribute)) {
            return {attr_begin + i};
        }
    }
    return std::nullopt;
}

/// Process a new node
NodeID ParserDriver::AddNode(sx::Node node) {
    auto node_id = nodes_.size();
    nodes_.push_back(sx::Node(node.location(), node.node_type(), node.attribute_key(), node_id,
                              node.children_begin_or_value(), node.children_count()));

    // Set parent reference
    if (node.node_type() == sx::NodeType::ARRAY ||
        static_cast<uint16_t>(node.node_type()) > static_cast<uint16_t>(sx::NodeType::OBJECT_KEYS_)) {
        auto begin = node.children_begin_or_value();
        auto end = begin + node.children_count();
        for (auto i = begin; i < end; ++i) {
            auto& n = nodes_[i];
            n = sx::Node(n.location(), n.node_type(), n.attribute_key(), node_id, n.children_begin_or_value(),
                         n.children_count());
        }
    }

    // Track dependencies
    auto text = scanner_.input_text();
    switch (node.node_type()) {
        case sx::NodeType::OBJECT_DASHQL_VIZ:
            if (auto name_id = FindAttribute(node, Key::DASHQL_VIZ_TARGET); name_id) {
                current_statement_.table_refs.push_back(
                    {*name_id,
                     QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace)});
            }
            break;

        case sx::NodeType::OBJECT_DASHQL_FETCH:
        case sx::NodeType::OBJECT_DASHQL_INPUT:
            if (auto name_id = FindAttribute(node, Key::DASHQL_STATEMENT_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            break;

        case sx::NodeType::OBJECT_DASHQL_LOAD:
            if (auto name_id = FindAttribute(node, Key::DASHQL_STATEMENT_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            if (auto name_id = FindAttribute(node, Key::DASHQL_DATA_SOURCE); name_id) {
                current_statement_.table_refs.push_back(
                    {*name_id,
                     QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace)});
            }
            break;

        case sx::NodeType::OBJECT_SQL_INTO:
            if (auto name_id = FindAttribute(node, Key::SQL_TEMP_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            break;

        case sx::NodeType::OBJECT_SQL_CREATE_AS:
            if (auto name_id = FindAttribute(node, Key::SQL_CREATE_AS_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            break;

        case sx::NodeType::OBJECT_SQL_CREATE:
            if (auto name_id = FindAttribute(node, Key::SQL_CREATE_TABLE_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            break;

        case sx::NodeType::OBJECT_SQL_VIEW:
            if (auto name_id = FindAttribute(node, Key::SQL_VIEW_NAME); name_id) {
                current_statement_.name =
                    QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace);
            }
            break;

        case sx::NodeType::OBJECT_SQL_TABLE_REF:
            if (auto name_id = FindAttribute(node, Key::SQL_TABLE_NAME); name_id) {
                current_statement_.table_refs.push_back(
                    {node_id,
                     QualifiedNameView::ReadFrom(nodes_, text, *name_id).WithDefaultSchema(options_.global_namespace)});
            }
            break;

        case sx::NodeType::OBJECT_SQL_COLUMN_REF:
            current_statement_.column_refs.push_back(node_id);
            break;
        default:
            break;
    }
    return node_id;
}

/// Compute the dependencies
void ParserDriver::ComputeDependencies() {
    auto text = scanner_.input_text();

    // Collect names
    std::unordered_map<QualifiedNameView, uint32_t, QualifiedNameView::Hasher> names;
    for (unsigned i = 0; i < statements_.size(); ++i) {
        auto& stmt = statements_[i];
        auto name = stmt.name.WithoutIndex();
        names.insert({name, i});
    }

    // Build dependencies
    for (unsigned i = 0; i < statements_.size(); ++i) {
        auto& stmt = statements_[i];

        // Resolve all table refs
        for (auto& [node, ref] : stmt.table_refs) {
            auto name = ref.WithoutIndex();
            if (auto iter = names.find(name); iter != names.end() && iter->second != i) {
                dependencies_.push_back(sx::Dependency(sx::DependencyType::TABLE_REF, iter->second, i, node));
            }
        }

        // Resolve all column refs
        for (auto& ref_id : stmt.column_refs) {
            auto& ref = nodes_[ref_id];

            if (auto path_id = FindAttribute(ref, Key::SQL_COLUMN_REF_PATH); path_id) {
                auto& path = nodes_[*path_id];
                auto begin = path.children_begin_or_value();

                std::vector<std::string_view> elems;
                for (auto i = 0; i < path.children_count(); ++i) {
                    auto& child = nodes_[begin + i];
                    auto elem = text.substr(child.location().offset(), child.location().length());
                    elems.push_back(elem);
                }

                QualifiedNameView maybeName{
                    .catalog = {},
                    .schema = {},
                    .relation = {},
                    .index_value = {},
                };
                switch (elems.size()) {
                    case 2:
                        maybeName.schema = elems[0];
                        maybeName.relation = elems[1];
                        break;
                    default:
                        continue;
                }
                if (auto iter = names.find(maybeName); iter != names.end() && iter->second != i) {
                    dependencies_.push_back(sx::Dependency(sx::DependencyType::COLUMN_REF, iter->second, i, ref_id));
                }
            }
        }
    }
}

/// Add an array
sx::Node ParserDriver::AddArray(sx::Location loc, nonstd::span<sx::Node> values, bool null_if_empty,
                                bool shrink_location) {
    auto begin = nodes_.size();
    nodes_.reserve(nodes_.size() + values.size());
    for (auto& v : values) {
        if (v.node_type() == sx::NodeType::NONE) continue;
        AddNode(v);
    }
    auto n = nodes_.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    if (n > 0 && shrink_location) {
        auto fstBegin = nodes_[begin].location().offset();
        auto lstEnd = nodes_.back().location().offset() + nodes_.back().location().length();
        loc = sx::Location(fstBegin, lstEnd - fstBegin);
    }
    return sx::Node(loc, sx::NodeType::ARRAY, 0, NO_PARENT, begin, n);
}

/// Add an object
sx::Node ParserDriver::AddObject(sx::Location loc, sx::NodeType type, nonstd::span<sx::Node> attrs, bool null_if_empty,
                                 bool shrink_location) {
    // Sort all the attributes
    auto begin = nodes_.size();
    nodes_.reserve(nodes_.size() + attrs.size());
    std::sort(attrs.begin(), attrs.end(), [&](auto& l, auto& r) {
        return static_cast<uint16_t>(l.attribute_key()) < static_cast<uint16_t>(r.attribute_key());
    });
    // Find duplicate ranges.
    // We optimize the fast path here and try to add as little overhead as possible for duplicate-free attributes.
    std::vector<nonstd::span<sx::Node>> duplicates;
    for (size_t i = 0, j = 1; j < attrs.size(); i = j++) {
        for (; j < attrs.size() && attrs[j].attribute_key() == attrs[i].attribute_key(); ++j)
            ;
        if ((j - i) == 1) continue;
        duplicates.emplace_back(attrs.data() + i, j - i);
    }
    // Merge attributes if there are any
    std::vector<sx::Node> merged_attrs;
    if (duplicates.size() > 0) {
        merged_attrs.reserve(attrs.size());

        auto* reader = attrs.data();
        std::vector<sx::Node> tmp;
        for (auto dups : duplicates) {
            // Copy attributes until first duplicate
            for (; reader != dups.data(); ++reader) merged_attrs.push_back(*reader);
            reader = dups.end();

            // Only keep first if its not an object
            auto& fst = dups[0];
            if (fst.node_type() < sx::NodeType::OBJECT_KEYS_) {
                merged_attrs.push_back(fst);
                continue;
            }
            // Otherwise merge child attributes
            size_t child_count = 0;
            for (auto dup : dups) child_count += dup.children_count();
            tmp.clear();
            tmp.reserve(child_count);
            for (auto dup : dups) {
                for (size_t l = 0; l < dup.children_count(); ++l) {
                    tmp.push_back(nodes_[dup.children_begin_or_value() + l]);
                }
            }
            // Add object.
            // Note that this will recursively merge paths such as style.data.fill and style.data.stroke
            auto merged = AddObject(fst.location(), fst.node_type(), merged_attrs, true, true);
            merged_attrs.push_back(merged);
        }
        for (; reader != attrs.end(); ++reader) merged_attrs.push_back(*reader);

        // Replace attributes
        attrs = {merged_attrs};
    }
    // Add the nodes
    for (auto& v : attrs) {
        if (v.node_type() == sx::NodeType::NONE) continue;
        AddNode(v);
    }
    auto n = nodes_.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    if (n > 0 && shrink_location) {
        auto fstBegin = nodes_[begin].location().offset();
        auto lstEnd = nodes_.back().location().offset() + nodes_.back().location().length();
        loc = sx::Location(fstBegin, lstEnd - fstBegin);
    }
    return sx::Node(loc, type, 0, NO_PARENT, begin, n);
}

static std::regex FETCH_URI_HTTP{"^https?://.*"};

/// Add a statement
void ParserDriver::AddStatement(sx::Node node) {
    if (node.node_type() == sx::NodeType::NONE) {
        return;
    }
    current_statement_.root = AddNode(node);
    auto stmt_type = sx::StatementType::NONE;
    switch (node.node_type()) {
        case sx::NodeType::OBJECT_DASHQL_SET:
            stmt_type = sx::StatementType::SET;
            break;

        case sx::NodeType::OBJECT_DASHQL_VIZ:
            stmt_type = sx::StatementType::VIZUALIZE;
            break;

        case sx::NodeType::OBJECT_DASHQL_FETCH:
            stmt_type = sx::StatementType::FETCH;
            break;

        case sx::NodeType::OBJECT_DASHQL_LOAD:
            stmt_type = sx::StatementType::LOAD;
            break;

        case sx::NodeType::OBJECT_DASHQL_INPUT:
            stmt_type = sx::StatementType::INPUT;
            break;

        case sx::NodeType::OBJECT_SQL_CREATE_AS:
            stmt_type = sx::StatementType::CREATE_TABLE_AS;
            break;

        case sx::NodeType::OBJECT_SQL_CREATE:
            stmt_type = sx::StatementType::CREATE_TABLE;
            break;

        case sx::NodeType::OBJECT_SQL_VIEW:
            stmt_type = sx::StatementType::CREATE_VIEW;
            break;

        case sx::NodeType::OBJECT_SQL_SELECT:
            if (auto into = FindAttribute(node, Key::SQL_SELECT_INTO); into) {
                stmt_type = sx::StatementType::SELECT_INTO;
            } else {
                stmt_type = sx::StatementType::SELECT;
            }
            break;

        default:
            assert(false);
    }
    current_statement_.type = stmt_type;
    statements_.push_back(std::move(current_statement_));
    current_statement_.reset();
}

/// Add an error
void ParserDriver::AddError(sx::Location loc, const std::string& message) { errors_.push_back({loc, message}); }

/// Get as flatbuffer object
std::shared_ptr<sx::ProgramT> ParserDriver::Finish() {
    auto program = std::make_unique<sx::ProgramT>();
    program->nodes = move(nodes_);
    program->statements.reserve(statements_.size());
    for (auto& stmt : statements_) {
        program->statements.push_back(stmt.Finish());
    }
    program->errors.reserve(errors_.size());
    for (auto& [loc, msg] : errors_) {
        auto err = std::make_unique<sx::ErrorT>();
        err->location = std::make_unique<sx::Location>(loc);
        err->message = move(msg);
        program->errors.push_back(move(err));
    }
    program->dson_keys = std::move(dson_keys_);
    program->highlighting = scanner_.BuildHighlighting();
    program->line_breaks = scanner_.ReleaseLineBreaks();
    program->comments = scanner_.ReleaseComments();
    program->dependencies = move(dependencies_);
    return program;
}

std::shared_ptr<sx::ProgramT> ParserDriver::Parse(std::string_view in, bool trace_scanning, bool trace_parsing) {
    // XXX shortcut until tests are migrated
    std::vector<char> padded_buffer{in.begin(), in.end()};
    padded_buffer.push_back(0);
    padded_buffer.push_back(0);

    Scanner scanner{padded_buffer};
    scanner.Produce();
    ParserDriver driver{scanner};

    dashql::parser::Parser parser(driver);
    parser.parse();

    driver.ComputeDependencies();

    return driver.Finish();
}

}  // namespace parser
}  // namespace dashql
