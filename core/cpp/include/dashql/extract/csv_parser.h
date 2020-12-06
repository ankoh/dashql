// Copyright (c) 2020 The DashQL Authors

// c.f.: dashql/extract/csv_extract.h

#ifndef INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_
#define INCLUDE_DASHQL_EXTRACT_CSV_PARSER_H_

#include <map>
#include "dashql/common/pattern_search.h"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/function/scalar/strftime.hpp"

namespace dashql {

struct CSVParserOptions {
    /// The blob size
    size_t in_size = 0;
    /// The SQL types
    std::vector<duckdb::LogicalType> sql_types = {};
    /// Delimiter to separate columns within each line
    std::string delimiter = ",";
    /// Quote used for columns that contain reserved characters, e.g., delimiter
    std::string quote = "\"";
    /// Escape character to escape quote character
    std::string escape = "\\";
    /// Whether or not the file has a header line
    bool header = false;
    /// How many leading rows to skip
    size_t skip_rows = 0;
    /// Expected number of columns
    size_t num_cols = 0;
    /// Specifies the std::string that represents a null value
    std::string null_str = "";
    /// True, if column with that index must skip null check
    std::vector<bool> force_not_null = {};
    /// Consider all columns to be of type varchar
    bool all_varchar = false;
    /// The date format to use (if any is specified)
    std::map<duckdb::LogicalTypeId, duckdb::StrpTimeFormat> date_format = {{duckdb::LogicalTypeId::DATE, {}}, {duckdb::LogicalTypeId::TIMESTAMP, {}}};
    /// Whether or not a type format is specified
    std::map<duckdb::LogicalTypeId, bool> has_format = {{duckdb::LogicalTypeId::DATE, false}, {duckdb::LogicalTypeId::TIMESTAMP, false}};

    /// Dump parser options as string
    std::string ToString() const;
};

class CSVOutputTarget {
    /// Flush a parsed data chunk
    virtual void Append(duckdb::DataChunk& data);
};

class CSVParser {
   protected:
    /// The parser options
    const CSVParserOptions& options;
    /// The input stream
    std::istream& in;
    /// The output target
    CSVOutputTarget& out;

    /// The buffer
    std::vector<char> buffer;
    /// The temporary buffer
    std::vector<char> tmp;
    /// The buffer size
    size_t buffer_size;
    /// The buffer position
    size_t buffer_position;
    /// The start of the current token
    size_t token_start;
    /// The current line
    size_t current_line;
    /// The current column
    size_t current_column;

    /// The data chunk
    duckdb::DataChunk chunk;

    /// Get the line number string
    std::string GetLineNumberStr();
    /// Read into buffer
    bool ReadBuffer();
    /// Add a value
    void AddValue(std::string_view val, std::vector<size_t> &escape_positions);
    /// Adds a row to the insert_chunk, returns true if the chunk is filled as a result of this row being added
    bool AddRow();
    /// Flush data chunk
    void Flush();

   public:
    /// Constructor
    CSVParser(const CSVParserOptions& options, std::istream& in, CSVOutputTarget& out);
    /// Move constructor to reuse state
    CSVParser(CSVParser&& other, const CSVParserOptions& options, std::istream& in, CSVOutputTarget& out);

};

class SimpleCSVParser: public CSVParser {
   public:
    /// Constructor
    SimpleCSVParser();
    /// Move constructor to reuse state
    SimpleCSVParser(SimpleCSVParser&& other, const CSVParserOptions& options, std::istream& in, CSVOutputTarget& out);
    /// Move assignment
    SimpleCSVParser& operator=(SimpleCSVParser&& other);

    /// Parse the input
    void Parse();
};


class ComplexCSVParser: public CSVParser {
   protected:
    /// The shift array for the delimiter search
    PatternShiftArray delimiter_search;
    /// The shift array for the escape search
    PatternShiftArray escape_search;
    /// The shift array for the quote search
    PatternShiftArray quote_search;

   public:
    /// Constructor
    ComplexCSVParser();
    /// Move constructor to reuse state
    ComplexCSVParser(ComplexCSVParser&& other, const CSVParserOptions& options, std::istream& in, CSVOutputTarget& out);
    /// Move assignment
    ComplexCSVParser& operator=(ComplexCSVParser&& other);

    /// Parse the input
    void Parse();
};

}

#endif
