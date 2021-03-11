#ifndef INCLUDE_DASHQL_ANALYZER_JSON_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_H_

#include "dashql/analyzer/analyzer.h"
#include "rapidjson/writer.h"

namespace dashql {

/// Read all options as JSON
void writeOptionsAsJSON(ProgramInstance& instance, size_t node_id, std::ostream& out, bool pretty = false);

}

#endif