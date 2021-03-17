#ifndef INCLUDE_DASHQL_ANALYZER_JSON_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_H_

#include <rapidjson/document.h>

#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"
#include "rapidjson/writer.h"

namespace dashql {

/// Read all options as DOM
rapidjson::Document readOptionsAsDOM(ProgramInstance& instance, size_t node_id);
/// Write document as SQLJSON
void writeSQLJSON(const rapidjson::Document& doc, std::ostream& out);
/// Write all options directly as JSON.
/// This is more efficient than SQLJSON since we don't materialize an intermediate DOM.
void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& out, bool pretty = false);

}  // namespace dashql

#endif