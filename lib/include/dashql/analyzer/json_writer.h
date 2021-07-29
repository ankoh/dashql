#ifndef INCLUDE_DASHQL_ANALYZER_JSON_WRITER_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_WRITER_H_

#include <unordered_map>
#include <vector>

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_sax.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"

namespace dashql {
namespace json {

class DocumentWriter {
   protected:
    /// The instance
    ProgramInstance& instance_;
    /// The node id
    size_t node_id_;
    /// The patch
    DocumentPatch patch_;

   public:
    /// Constructor
    DocumentWriter(ProgramInstance& instance, size_t node_id, const ASTIndex& ast);

    /// Get the patch
    auto& patch() { return patch_; }

    /// Write as JSON.
    void writeAsJSON(std::ostream& out, bool pretty = false, bool only_dson = false);
    /// Write as script.
    void writeAsScript(std::ostream& out, bool pretty = false, bool only_dson = false);
};

}  // namespace json
}  // namespace dashql

#endif
