// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#include <iostream>
#include <memory>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/json_parser.h"
#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"

namespace duckdb {
namespace web {
namespace json {

/// A reader event
enum class ReaderEvent {
    NONE,
    KEY,
    NULL_,
    STRING,
    BOOL,
    INT32,
    INT64,
    UINT32,
    UINT64,
    DOUBLE,
    START_OBJECT,
    START_ARRAY,
    END_OBJECT,
    END_ARRAY,
};

/// Get the json reader event name
std::string_view GetReaderEventName(ReaderEvent event);

/// A helper to remember the last JSON key for iterative parsing
struct KeyReader : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, KeyReader> {
    ReaderEvent event = ReaderEvent::NONE;
    std::string key_buffer = "";
    std::string_view key = "";

    std::string ReleaseKey() {
        if (!key_buffer.empty()) {
            key = {};
            return std::move(key_buffer);
        } else {
            return std::string{std::move(key)};
        }
    }
    bool SetEvent(ReaderEvent e) {
        event = e;
        return true;
    }
    bool Key(const char* txt, size_t length, bool copy) {
        if (copy) {
            key_buffer = std::string{txt, length};
            key = key_buffer;
        } else {
            key_buffer.clear();
            key = std::string_view{txt, length};
        }
        return SetEvent(ReaderEvent::KEY);
    }
    bool Null() { return SetEvent(ReaderEvent::NULL_); }
    bool RawNumber(const Ch* str, size_t len, bool copy) { assert(false); }
    bool String(const char* txt, size_t length, bool copy) { return SetEvent(ReaderEvent::STRING); }
    bool Bool(bool v) { return SetEvent(ReaderEvent::BOOL); }
    bool Int(int32_t v) { return SetEvent(ReaderEvent::INT32); }
    bool Int64(int64_t v) { return SetEvent(ReaderEvent::INT64); }
    bool Uint(uint32_t v) { return SetEvent(ReaderEvent::UINT32); }
    bool Uint64(uint64_t v) { return SetEvent(ReaderEvent::UINT64); }
    bool Double(double v) { return SetEvent(ReaderEvent::DOUBLE); }
    bool StartObject() { return SetEvent(ReaderEvent::START_OBJECT); }
    bool StartArray() { return SetEvent(ReaderEvent::START_ARRAY); }
    bool EndObject(size_t count) { return SetEvent(ReaderEvent::END_OBJECT); }
    bool EndArray(size_t count) { return SetEvent(ReaderEvent::END_ARRAY); }
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
