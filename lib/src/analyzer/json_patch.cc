#include "dashql/analyzer/json_patch.h"

namespace dashql {
namespace json {

/// Ignore a node id
DocumentPatch& DocumentPatch::Ignore(std::initializer_list<size_t> node_ids) {
    for (auto node_id : node_ids) {
        ignore.insert(node_id);
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
