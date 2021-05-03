// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#include <stack>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "arrow/io/buffered.h"
#include "arrow/io/interfaces.h"
#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "dashql/common/json_sax.h"
#include "nonstd/span.h"

namespace dashql {
namespace json {

/// The ArrowReader reads arrow tables from a json document
class ArrowReader {
   protected:
    /// The input buffer
    std::unique_ptr<char[]> input_buffer_;
    /// The SAX document
    SAXDocument document_;
    /// The current pointer in the document
    size_t reader_position_;
    /// The current stack of SAX ops
    std::vector<SAXOp> reader_stack_;
    /// The current arrow schema (if any)
    std::unique_ptr<arrow::Schema> current_schema_ = nullptr;

    /// Infer a row-major schema
    arrow::Result<std::shared_ptr<arrow::Buffer>> InferRowMajorSchema();
    /// Infer a column-major schema
    arrow::Result<std::shared_ptr<arrow::Buffer>> InferColumnMajorSchema();

   public:
    /// Prepare json without jmespath
    arrow::Result<std::shared_ptr<arrow::Buffer>> Prepare(std::unique_ptr<char[]> input);
    /// Prepare json filtered with jmespath
    arrow::Result<std::shared_ptr<arrow::Buffer>> PrepareFiltered(std::unique_ptr<char[]> input,
                                                                  std::string_view jmespath);
    /// Read the next record batch
    arrow::Result<std::shared_ptr<arrow::Buffer>> NextBatch();
};

}  // namespace json
}  // namespace dashql

#endif
