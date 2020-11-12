// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/common/hash.h"
#include "dashql/parser/parser_driver.h"

#include <iostream>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
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
    return sx::Node(node.location(), node.node_type(), key, node.children_begin_or_value(), node.children_count());
}

/// Syntactic sugar concatenate vectors
NodeVector& operator<<(NodeVector& attrs, const sx::Node& node) {
    attrs.push_back(node);
    return attrs;
}

/// Syntactic sugar concatenate vectors
NodeVector& operator<<(NodeVector& attrs, NodeVector&& other) {
    for (auto& node : other) {
        attrs.push_back(node);
    }
    return attrs;
}

ScriptOptions::ScriptOptions() : global_namespace("global") {}

/// Constructor
Statement::Statement() : root(), name(), table_refs(), global_column_refs() {}

/// Move constructor
Statement::Statement(Statement&& other)
    : root(other.root),
      name(other.name),
      table_refs(std::move(other.table_refs)),
      global_column_refs(std::move(other.global_column_refs)) {
    other.root = std::numeric_limits<NodeID>::max();
}

/// Encode name
fb::Offset<fb::String> Statement::encodeName(fb::FlatBufferBuilder& builder) {
    std::string buffer;
    auto [table, schema] = name;
    buffer.resize(table.size() + 1 + schema.size());
    schema.copy(buffer.data(), schema.size());
    buffer[schema.size()] = '.';
    table.copy(buffer.data() + table.size() + 1, table.size());
    return builder.CreateString(buffer);
}

/// Move assignment
Statement& Statement::operator=(Statement&& other) {
    root = other.root;
    name = other.name;
    table_refs = std::move(other.table_refs);
    global_column_refs = std::move(other.global_column_refs);
    other.root = std::numeric_limits<NodeID>::max();
    return *this;
}

/// Constructor
ParserDriver::ParserDriver(Scanner& scanner)
    : _scanner(scanner), _options(), _nodes(), _current_statement(), _statements(), _dependencies(), _errors() {}

/// Destructor
ParserDriver::~ParserDriver() {}

/// Find an attribute
std::pair<const sx::Node*, size_t> ParserDriver::FindAttribute(const sx::Node& node, Key attribute) const {
    auto attr_begin = node.children_begin_or_value();
    auto attr_count = node.children_count();
    for (auto i = 0; i < attr_count; ++i) {
        auto& attr = _nodes[attr_begin + i];
        if (attr.attribute_key() == attribute) {
            return {&attr, attr_begin + i};
        }
    }
    return {nullptr, 0};
}

/// Get as string array
QualifiedName ParserDriver::AsQualifiedName(const sx::Node& node) {
    if (node.node_type() != sx::NodeType::ARRAY)
        return {};
    auto begin = node.children_begin_or_value();
    auto count = node.children_count();
    auto end = begin + count;
    unsigned next = 0;
    std::array<std::string_view, 2> rev;
    for (auto i = 0; i < count && next < rev.size(); ++i) {
        auto& value = _nodes[end - i - 1];
        if (value.node_type() == sx::NodeType::STRING) {
            rev[next++] = _scanner.TextAt(value.location());
        }
    }
    if (rev[1].empty())
        rev[1] = _options.global_namespace;
    return rev;
}

/// Compute the dependencies
void ParserDriver::ComputeDependencies() {
    // Collect names
    std::unordered_map<QualifiedName, uint32_t, ArrayHasher<std::string_view, 2>> names;
    for (unsigned i = 0; i < _statements.size(); ++i) {
        auto& stmt = _statements[i];
        names.insert({stmt.name, stmt.root});
    }

    // Build dependencies
    for (unsigned i = 0; i < _statements.size(); ++i) {
        auto& stmt = _statements[i];
        for (auto& ref_id: stmt.table_refs) {
            auto& ref = _nodes[ref_id];
            assert(ref.node_type() == sx::NodeType::OBJECT_SQL_TABLE_REF);

            // Find name attribute (if any)
            if (auto [name, name_id] = FindAttribute(ref, Key::SQL_TABLE_NAME); name) {
                auto [table, schema] = AsQualifiedName(*name);
                if (auto iter = names.find({table, schema}); iter != names.end()) {
                    _dependencies.push_back(sx::Dependency(sx::DependencyType::TABLE_REF, iter->second, i, name_id));
                }
            }
        }
    }
}

/// Add an array
sx::Node ParserDriver::Add(sx::Location loc, NodeVector&& values, bool null_if_empty) {
    auto begin = _nodes.size();
    _nodes.reserve(_nodes.size() + values.size());
    for (auto& v : values) {
        if (v.node_type() == sx::NodeType::NONE) {
            continue;
        }
        _nodes.push_back(v);
    }
    auto n = _nodes.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    return sx::Node(loc, sx::NodeType::ARRAY, sx::AttributeKey::NONE, begin, n);
}

/// Add an object
sx::Node ParserDriver::Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty) {
    auto begin = _nodes.size();
    _nodes.reserve(_nodes.size() + attrs.size());
    for (auto& v : attrs) {
        auto t = v.node_type();
        if (t == sx::NodeType::NONE) continue;
        auto n = _nodes.size();
        _nodes.push_back(v);
        switch (t) {
            case sx::NodeType::OBJECT_SQL_TABLE_REF:
                // Store the table ref directly
                _current_statement.table_refs.push_back(n);
                break;

            case sx::NodeType::OBJECT_SQL_COLUMN_REF: {
                // Find path attribute (if any)
                if (auto [path, path_id] = FindAttribute(v, Key::SQL_COLUMN_REF_PATH); path) {
                    assert(path->node_type() == sx::NodeType::ARRAY);
                    assert(path->children_count() > 0);

                    // Does the path root refer to the global namespace?
                    auto root_id = path->children_begin_or_value();
                    auto& root = _nodes[root_id];
                    assert(root.node_type() == sx::NodeType::STRING);
                    auto root_text = _scanner.TextAt(root.location());
                    if (root_text == _options.global_namespace) {
                        _current_statement.global_column_refs.push_back(root_id);
                    }
                }
                _current_statement.table_refs.push_back(n);
            }

            case sx::NodeType::OBJECT_SQL_INTO:
                // Find path attribute (if any)
                if (auto [name, name_id] = FindAttribute(v, Key::SQL_TEMP_NAME); name) {
                    _current_statement.name = AsQualifiedName(*name);
                }
                break;

            default:
                break;
        }
    }
    auto n = _nodes.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    return sx::Node(loc, type, sx::AttributeKey::NONE, begin, n);
}

/// Add a statement
void ParserDriver::AddStatement(sx::Node node) {
    if (node.node_type() != sx::NodeType::NONE) {
        _current_statement.root = _nodes.size();
        _nodes.push_back(node);
        _statements.push_back(std::move(_current_statement));
    }
}

/// Add an error
void ParserDriver::AddError(sx::Location loc, const std::string& message) { _errors.push_back({loc, message}); }

/// Write the module
fb::Offset<sx::Module> ParserDriver::Write(fb::FlatBufferBuilder& builder) {
    std::vector<fb::Offset<sx::Statement>> statements;
    for (auto& stmt: _statements) {
        auto stmt_loc = _nodes[stmt.root].location();
        std::optional<fb::Offset<fb::String>> name;
        if (!stmt.name.empty()) {
            name = stmt.encodeName(builder);
        }
        sx::StatementBuilder sb{builder};
        sb.add_root(stmt.root);
        if (name) {
            sb.add_name(*name);
        }
        statements.push_back(sb.Finish());
    }
    std::vector<fb::Offset<sx::Error>> errs;
    for (auto [loc, msg] : _errors) {
        auto s = builder.CreateString(msg.data(), msg.length());
        sx::ErrorBuilder eb{builder};
        eb.add_location(&loc);
        eb.add_message(s);
        errs.push_back(eb.Finish());
    }
    auto nodes_vec = builder.CreateVectorOfStructs(_nodes);
    auto statements_vec = builder.CreateVector(statements);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_scanner.line_breaks());
    auto comments_vec = builder.CreateVectorOfStructs(_scanner.comments());
    sx::ModuleBuilder b{builder};
    b.add_nodes(nodes_vec);
    b.add_statements(statements_vec);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_comments(comments_vec);
    return b.Finish();
}

flatbuffers::Offset<sx::Module> ParserDriver::Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in,
                                                    bool trace_scanning, bool trace_parsing) {
    // XXX shortcut until tests are migrated
    std::vector<char> padded_buffer{in.begin(), in.end()};
    padded_buffer.push_back(0);
    padded_buffer.push_back(0);

    Scanner scanner{padded_buffer};
    ParserDriver driver{scanner};

    dashql::parser::Parser parser(driver);
    parser.parse();

    return driver.Write(builder);
}

}  // namespace parser
}  // namespace dashql
