#include "dashql/analyzer/json_patch.h"

#include "dashql/analyzer/syntax_matcher.h"

namespace dashql {
namespace json {

/// Constructor
DocumentPatch::DocumentPatch(const ASTIndex& ast) : ast(ast) {}

/// Ignore a node id
DocumentPatch& DocumentPatch::Ignore(std::initializer_list<size_t> ast_ids) {
    for (auto ast_id : ast_ids) {
        if (!ast[ast_id].IsMatched()) continue;
        ignore.insert(ast[ast_id].node_id);
    }
    return *this;
}

/// Append a node id
DocumentPatch& DocumentPatch::Append(size_t node_id, json::SAXNode node) {
    if (auto iter = append.find(node_id); iter != append.end()) {
        iter->second.push_back(std::move(node));
    } else {
        append.insert({node_id, {std::move(node)}});
    }
    return *this;
}

}  // namespace json
}  // namespace dashql
