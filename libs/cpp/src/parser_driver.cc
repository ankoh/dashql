// Copyright (c) 2020 The DashQL Authors

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

/// Constructor
ParserDriver::ParserDriver(Scanner& scanner) : _scanner(scanner), _nodes(), _statements(), _errors() {}

/// Destructor
ParserDriver::~ParserDriver() {}

/// Add an array
sx::Node ParserDriver::Add(sx::Location loc, NodeVector&& values, bool null_if_empty) {
    auto begin = _nodes.size();
    _nodes.reserve(_nodes.size() + values.size());
    for (auto& v : values) {
        if (v.node_type() != sx::NodeType::NONE) {
            _nodes.push_back(v);
        }
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
        if (v.node_type() != sx::NodeType::NONE) {
            _nodes.push_back(v);
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
        _nodes.push_back(node);
        _statements.push_back(_nodes.size() - 1);
    }
}

/// Add an error
void ParserDriver::AddError(sx::Location loc, const std::string& message) { _errors.push_back({loc, message}); }

/// Write the module
fb::Offset<sx::Module> ParserDriver::Write(fb::FlatBufferBuilder& builder) {
    std::vector<fb::Offset<sx::Error>> errs;
    for (auto [loc, msg] : _errors) {
        auto s = builder.CreateString(msg.data(), msg.length());
        sx::ErrorBuilder eb{builder};
        eb.add_location(&loc);
        eb.add_message(s);
        errs.push_back(eb.Finish());
    }
    auto nodes_vec = builder.CreateVectorOfStructs(_nodes);
    auto statements_vec = builder.CreateVector(_statements);
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
