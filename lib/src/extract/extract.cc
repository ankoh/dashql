#include "dashql/extract/extract.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"

namespace dashql {

/// Extract csv
Signal ExtractCSV(webdb::WebDB::Connection& connection, BlobStreamBuffer& blob_streambuf,
                  duckdb::BufferedCSVReaderOptions csv_options, std::vector<duckdb::LogicalType>&& csv_col_types,
                  const std::string& schema_name, const std::string& table_name) {

    // Parse csv blob
    auto blob_stream = std::make_unique<std::istream>(&blob_streambuf);
    duckdb::BufferedCSVReader reader(csv_options, move(csv_col_types), move(blob_stream));
    duckdb::DataChunk data_chunk;
    reader.ParseCSV(data_chunk);

    // Assemble the CREATE TABLE statement
    auto& conn = connection.GetConnection();
    auto& sql_types = reader.sql_types;
    auto& col_names = reader.col_names;

    // Too few column names?
    // The buffered csv reader generates names for us, so this might actually never happen.
    if (col_names.size() < sql_types.size()) {
        return Error{ErrorCode::INTERNAL_ERROR, "missing csv column names"};
    }

    // Build the create table statement
    std::stringstream stmt;
    stmt << "CREATE TABLE ";
    if (!schema_name.empty()) {
        stmt << schema_name << ".";
    }
    stmt << table_name << "(";
    for (unsigned i = 0; i < sql_types.size(); ++i) {
        if (i > 0) {
            stmt << ", ";
        }
        stmt << col_names[i] << " ";
        stmt << sql_types[i].ToString();
    }
    stmt << ")";
    auto stmt_str = stmt.str();

    // Create the table
    auto result = conn.Query(stmt_str);
    if (!result->success) {
        return Error{ErrorCode::QUERY_FAILED, result->error};
    }

    // Append the data chunk to the table
    auto table_info = conn.TableInfo(schema_name, table_name);
    conn.Append(*table_info, data_chunk);
    return Signal::OK();    
}

}
