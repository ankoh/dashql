#ifndef INCLUDE_DASHQL_ANALYZER_JSON_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_H_

#include "dashql/analyzer/program_instance.h"
#include "rapidjson/writer.h"

namespace dashql {

/// The writer type
enum JSONWriterType { JSON, JSON_PRETTY, SQLJSON_PRETTY };

/// Read all options as JSON
void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& out,
                        JSONWriterType writer = JSONWriterType::JSON);

}  // namespace dashql

#endif