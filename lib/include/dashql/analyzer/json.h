#ifndef INCLUDE_DASHQL_ANALYZER_JSON_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_H_

#include <rapidjson/document.h>

#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"
#include "rapidjson/writer.h"

namespace dashql {

/// The writer type
enum JSONWriterType { JSON, JSON_PRETTY, SQLJSON_PRETTY };

using PatchedOption = std::pair<sx::AttributeKey, rapidjson::Document>;

/// Read all options as JSON
void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& out, JSONWriterType writer,
                        const std::unordered_map<size_t, PatchedOption>& patches);

}  // namespace dashql

#endif