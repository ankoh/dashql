// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_EXTRACT_EXTRACT_H_
#define INCLUDE_DASHQL_EXTRACT_EXTRACT_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "dashql/analyzer/program_instance.h"
#include "dashql/common/blob_stream.h"
#include "dashql/common/expected.h"
#include "dashql/common/raw_buffer.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"

namespace dashql {

/// Extract csv
Signal ExtractCSV(webdb::WebDB::Connection& connection, BlobStreamBuffer& blob_streambuf,
                  duckdb::BufferedCSVReaderOptions csv_options, std::vector<duckdb::LogicalType>&& csv_col_types,
                  const std::string& schema_name, const std::string& table_name);

}  // namespace dashql

#endif  // INCLUDE_DASHQL_EXTRACT_EXTRACT_H_
