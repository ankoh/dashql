// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/parser_driver.h"

#include <iostream>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

#include "dashql/common/error.h"
#include "dashql/common/hash.h"
#include "dashql/common/variant.h"
#include "dashql/parser/grammar/nodes.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"

namespace fb = flatbuffers;

namespace dashql {
namespace parser {

/// Printing locations
std::ostream& operator<<(std::ostream& out, const Location& loc) {
    out << "[" << loc.offset() << "," << (loc.offset() + loc.length()) << "[";
    return out;
}

/// Syntactic sugar to set the key of a node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node) {
    return sx::Node(node.location(), node.node_type(), key, node.parent(), node.children_begin_or_value(),
                    node.children_count());
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

ScriptOptions::ScriptOptions() : global_namespace("global") {}

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
    auto [table, schema] = name;
    auto stmt = std::make_unique<sx::StatementT>();
    stmt->statement_type = type;
    stmt->root_node = root;
    stmt->name_short = table;

    // Store qualified name
    if (schema.empty()) {
        stmt->name_qualified = move(table);
    } else {
        std::string buffer;
        buffer.resize(schema.size() + 1 + table.size());
        schema.copy(buffer.data(), schema.size());
        buffer[schema.size()] = '.';
        table.copy(buffer.data() + schema.size() + 1, table.size());
        stmt->name_qualified = move(buffer);
    }
    return stmt;
}

/// Constructor
ParserDriver::ParserDriver(Scanner& scanner)
    : scanner_(scanner), options_(), nodes_(), current_statement_(), statements_(), dependencies_(), errors_() {}

/// Destructor
ParserDriver::~ParserDriver() {}

/// Find an attribute
std::pair<const sx::Node*, size_t> ParserDriver::FindAttribute(const sx::Node& node, Key attribute) const {
    auto attr_begin = node.children_begin_or_value();
    auto attr_count = node.children_count();
    for (auto i = 0; i < attr_count; ++i) {
        auto& attr = nodes_[attr_begin + i];
        if (attr.attribute_key() == attribute) {
            return {&attr, attr_begin + i};
        }
    }
    return {nullptr, 0};
}

/// Get as string array
QualifiedName ParserDriver::AsQualifiedName(const sx::Node& node, bool lift_global) {
    std::array<std::string_view, 2> rev;

    // Is string?
    if (node.node_type() == sx::NodeType::STRING_REF) {
        rev[0] = scanner_.TextAt(node.location());
    }

    // Is array?
    else if (node.node_type() == sx::NodeType::ARRAY) {
        auto begin = node.children_begin_or_value();
        auto count = node.children_count();
        auto end = begin + count;
        unsigned next = 0;
        for (auto i = 0; i < count && next < rev.size(); ++i) {
            auto& value = nodes_[end - i - 1];
            if (value.node_type() == sx::NodeType::STRING_REF) {
                rev[next++] = scanner_.TextAt(value.location());
            }
        }
    }

    // Is table ref?
    else if (node.node_type() == sx::NodeType::OBJECT_SQL_TABLE_REF) {
        if (auto [name, name_id] = FindAttribute(node, Key::SQL_TABLE_NAME); name) {
            return AsQualifiedName(*name, true);
        }
    }

    if (rev[1].empty() && lift_global) rev[1] = options_.global_namespace;
    return rev;
}

/// Process a new node
NodeID ParserDriver::AddNode(sx::Node node) {
    auto node_id = nodes_.size();
    nodes_.push_back(sx::Node(node.location(), node.node_type(), node.attribute_key(), node_id,
                              node.children_begin_or_value(), node.children_count()));

    // Set parent reference
    if (node.node_type() == sx::NodeType::ARRAY ||
        static_cast<uint16_t>(node.node_type()) > static_cast<uint16_t>(sx::NodeType::OBJECT_MIN_)) {
        auto begin = node.children_begin_or_value();
        auto end = begin + node.children_count();
        for (auto i = begin; i < end; ++i) {
            auto& n = nodes_[i];
            n = sx::Node(n.location(), n.node_type(), n.attribute_key(), node_id, n.children_begin_or_value(),
                         n.children_count());
        }
    }

    // Track dependencies
    switch (node.node_type()) {
        case sx::NodeType::OBJECT_DASHQL_VIZ:
        case sx::NodeType::OBJECT_DASHQL_LOAD:
        case sx::NodeType::OBJECT_DASHQL_PARAMETER:
            if (auto [name, name_id] = FindAttribute(node, Key::DASHQL_STATEMENT_NAME); name) {
                current_statement_.name = AsQualifiedName(*name, true);
            }
            break;

        case sx::NodeType::OBJECT_DASHQL_EXTRACT:
            if (auto [name, name_id] = FindAttribute(node, Key::DASHQL_STATEMENT_NAME); name) {
                current_statement_.name = AsQualifiedName(*name, true);
            }
            if (auto [name, name_id] = FindAttribute(node, Key::DASHQL_EXTRACT_DATA); name) {
                current_statement_.table_refs.push_back({name_id, AsQualifiedName(*name, true)});
            }
            break;

        case sx::NodeType::OBJECT_SQL_INTO:
            if (auto [name, name_id] = FindAttribute(node, Key::SQL_TEMP_NAME); name) {
                current_statement_.name = AsQualifiedName(*name, true);
            }
            break;

        case sx::NodeType::OBJECT_SQL_CREATE_AS:
            if (auto [name, name_id] = FindAttribute(node, Key::SQL_CREATE_AS_NAME); name) {
                current_statement_.name = AsQualifiedName(*name, true);
            }
            break;

        case sx::NodeType::OBJECT_SQL_VIEW:
            if (auto [name, name_id] = FindAttribute(node, Key::SQL_VIEW_NAME); name) {
                current_statement_.name = AsQualifiedName(*name, true);
            }
            break;

        case sx::NodeType::OBJECT_SQL_TABLE_REF:
            current_statement_.table_refs.push_back({node_id, AsQualifiedName(node, true)});
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
    // Collect names
    std::unordered_map<QualifiedName, uint32_t, ArrayHasher<std::string_view, 2>> names;
    for (unsigned i = 0; i < statements_.size(); ++i) {
        auto& stmt = statements_[i];
        names.insert({stmt.name, i});
    }

    // Build dependencies
    for (unsigned i = 0; i < statements_.size(); ++i) {
        auto& stmt = statements_[i];

        // Resolve all table refs
        for (auto& [node, name] : stmt.table_refs) {
            auto [table, schema] = name;
            if (auto iter = names.find({table, schema}); iter != names.end() && iter->second != i) {
                dependencies_.push_back(sx::Dependency(sx::DependencyType::TABLE_REF, iter->second, i, node));
            }
        }

        // Resolve all column refs
        for (auto& ref_id : stmt.column_refs) {
            auto& ref = nodes_[ref_id];
            if (auto [path, path_id] = FindAttribute(ref, Key::SQL_COLUMN_REF_PATH); path) {
                auto [table, schema] = AsQualifiedName(*path, false);
                if (auto iter = names.find({table, schema}); iter != names.end() && iter->second != i) {
                    dependencies_.push_back(sx::Dependency(sx::DependencyType::COLUMN_REF, iter->second, i, ref_id));
                }
            }
        }
    }
}

/// Add an array
sx::Node ParserDriver::Add(sx::Location loc, NodeVector&& values, bool null_if_empty, bool shrink_location) {
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
        auto fstBegin = nodes_[0].location().offset();
        auto lstEnd = nodes_.back().location().offset() + nodes_.back().location().length();
        loc = sx::Location(fstBegin, lstEnd - fstBegin);
    }
    return sx::Node(loc, sx::NodeType::ARRAY, sx::AttributeKey::NONE, NO_PARENT, begin, n);
}

/// Add an object
sx::Node ParserDriver::Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty, bool skip_none) {
    auto begin = nodes_.size();
    nodes_.reserve(nodes_.size() + attrs.size());
    std::sort(attrs.begin(), attrs.end(), [&](auto& l, auto& r) {
        return static_cast<uint16_t>(l.attribute_key()) < static_cast<uint16_t>(r.attribute_key());
    });
    for (auto& v : attrs) {
        if (skip_none && v.node_type() == sx::NodeType::NONE) continue;
        AddNode(v);
    }
    auto n = nodes_.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    return sx::Node(loc, type, sx::AttributeKey::NONE, NO_PARENT, begin, n);
}

/// Add a statement
void ParserDriver::AddStatement(sx::Node node) {
    if (node.node_type() == sx::NodeType::NONE) {
        return;
    }
    current_statement_.root = AddNode(node);
    auto stmt_type = sx::StatementType::NONE;
    switch (node.node_type()) {
        case sx::NodeType::OBJECT_DASHQL_VIZ:
            stmt_type = sx::StatementType::VIZUALIZE;
            break;

        case sx::NodeType::OBJECT_DASHQL_LOAD:
            if (auto [m, _] = FindAttribute(node, Key::DASHQL_LOAD_METHOD); m) {
                switch (static_cast<sx::LoadMethodType>(m->children_begin_or_value())) {
                    case sx::LoadMethodType::FILE:
                        stmt_type = sx::StatementType::LOAD_FILE;
                        break;
                    case sx::LoadMethodType::HTTP:
                        stmt_type = sx::StatementType::LOAD_HTTP;
                        break;
                    default:
                        stmt_type = sx::StatementType::NONE;
                        break;
                }
            }
            break;

        case sx::NodeType::OBJECT_DASHQL_EXTRACT:
            if (auto [m, _] = FindAttribute(node, Key::DASHQL_EXTRACT_METHOD); m) {
                switch (static_cast<sx::ExtractMethodType>(m->children_begin_or_value())) {
                    case sx::ExtractMethodType::JSON:
                        stmt_type = sx::StatementType::EXTRACT_JSON;
                        break;
                    case sx::ExtractMethodType::CSV:
                        stmt_type = sx::StatementType::EXTRACT_CSV;
                        break;
                    default:
                        stmt_type = sx::StatementType::NONE;
                        break;
                }
            }
            break;

        case sx::NodeType::OBJECT_DASHQL_PARAMETER:
            stmt_type = sx::StatementType::PARAMETER;
            break;

        case sx::NodeType::OBJECT_SQL_CREATE_AS:
            stmt_type = sx::StatementType::CREATE_TABLE_AS;
            break;

        case sx::NodeType::OBJECT_SQL_VIEW:
            stmt_type = sx::StatementType::CREATE_VIEW;
            break;

        case sx::NodeType::OBJECT_SQL_SELECT:
            if (auto [into, _] = FindAttribute(node, Key::SQL_SELECT_INTO); into) {
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
}

/// Add an error
void ParserDriver::AddError(sx::Location loc, const std::string& message) { errors_.push_back({loc, message}); }

/// Get as flatbuffer object
std::shared_ptr<sx::ProgramT> ParserDriver::Finish() {
    auto program = std::make_unique<sx::ProgramT>();
    program->nodes = move(nodes_);
    program->statements.reserve(statements_.size());
    for (auto& stmt: statements_) {
        program->statements.push_back(stmt.Finish());
    }
    program->errors.reserve(errors_.size());
    for (auto& [loc, msg]: errors_) {
        auto err = std::make_unique<sx::ErrorT>();
        err->location = std::make_unique<sx::Location>(loc);
        err->message = move(msg);
        program->errors.push_back(move(err));
    }
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
    ParserDriver driver{scanner};

    dashql::parser::Parser parser(driver);
    parser.parse();

    driver.ComputeDependencies();

    return driver.Finish();
}

}  // namespace parser
}  // namespace dashql
