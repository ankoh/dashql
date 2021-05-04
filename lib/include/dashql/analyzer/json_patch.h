#ifndef INCLUDE_DASHQL_ANALYZER_JSON_PATCH_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_PATCH_H_

#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "dashql/analyzer/json_sax.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"

namespace dashql {
namespace json {

struct DocumentPatch {
    /// The AST index
    const ASTIndex& ast;
    /// The nodes to ignore
    std::unordered_set<size_t> ignore = {};
    /// The nodes to append
    std::unordered_map<size_t, std::vector<SAXDocument>> append = {};

    /// Constructor
    DocumentPatch(const ASTIndex& ast);

    /// Ignore a node id
    DocumentPatch& Ignore(std::initializer_list<size_t> ast_ids);
    /// Ignore a node id
    DocumentPatch& Append(size_t node_id, SAXDocument node);
};

}  // namespace json
}  // namespace dashql

#endif
