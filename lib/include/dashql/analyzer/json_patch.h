#ifndef INCLUDE_DASHQL_ANALYZER_JSON_PATCH_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_PATCH_H_

#include <unordered_map>
#include <vector>

#include "dashql/analyzer/json_sax.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"

namespace dashql {
namespace json {

struct DocumentPatch {
    /// The syntax matcher
    SchemaMap& schema;
    /// Nodes to ignore
    std::unordered_set<size_t> ignore = {};
    /// Node to append
    std::unordered_map<size_t, std::vector<SAXNode>> append = {};

    /// Constructor
    DocumentPatch(SchemaMap& schema);

    /// Ignore a node id
    DocumentPatch& Ignore(std::initializer_list<size_t> node_id);
    /// Ignore a node id
    DocumentPatch& Append(size_t node_id, SAXNode node);
};

}  // namespace json
}  // namespace dashql

#endif
