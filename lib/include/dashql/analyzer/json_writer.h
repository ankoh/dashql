#ifndef INCLUDE_DASHQL_ANALYZER_JSON_WRITER_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_WRITER_H_

#include <unordered_map>
#include <vector>

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_sax.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"

namespace dashql {
namespace json {

class NodeWriter {
   protected:
    /// The instance
    ProgramInstance& instance_;
    /// The node id
    size_t node_id_;
    /// The patch
    DocumentPatch patch_;

   public:
    /// Constructor
    NodeWriter(ProgramInstance& instance, size_t node_id);

    /// Get the patch
    auto& patch() { return patch_; }

    /// Write all options directly as JSON.
    void writeOptionsAsJSON(std::ostream& out, bool pretty = false);
    /// Write all options directly as SQLJSON.
    void writeOptionsAsSQLJSON(std::ostream& out, bool pretty = false);
};

}  // namespace json
}  // namespace dashql

#endif
