// Copyright (c) 2020 The DashQL Authors

#include "dashql/reader/json/json_reader.h"

#include <rapidjson/document.h>
#include <rapidjson/reader.h>

#include "dashql/common/json_sax.h"
#include "rapidjson/memorystream.h"

namespace dashql {
namespace json {

static constexpr size_t SCHEMA_ROW_COUNT = 10;

///// Prepare json without jmespath
// arrow::Result<std::shared_ptr<arrow::Buffer>> ArrowReader::Prepare(std::unique_ptr<char[]> input) {
//    std::string_view input_view{input.get()};
//    rapidjson::MemoryStream input_stream{input_view.data(), input_view.size()};
//
//    // Parse the SAX document
//    rapidjson::Reader reader;
//    reader.IterativeParseInit();
//
//    while (!reader.IterativeParseNext<rapidjson::kParseDefaultFlags>(InputStream &is, Handler &handler))
//
//    reader.Parse(input_stream, document_);
//
//    if (document_.empty()) {
//        // Return something
//    }
//
//    // Is top-level object?
//    // We assume that the user gave us an object of columns.
//    if (document_[0].tag == SAXOpTag::OBJECT_START) {
//        return Infer
//    }
//
//    // Infer the schema
//    reader_stack_.clear();
//
//    for (reader_position_ = 0; reader_position_ != document_.ops.size(); ++reader_position_) {
//        // End of a top-level object?
//        if (reader_stack_.size() == 1) {
//        }
//    }
//}

}  // namespace json
}  // namespace dashql
