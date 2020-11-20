// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_COMMON_EXPECTED_H_
#define INCLUDE_DUCKDB_WEB_COMMON_EXPECTED_H_

#include <variant>

#include "duckdb/web/common/span.h"
#include "flatbuffers/flatbuffers.h"

namespace duckdb {
namespace web {

enum class ErrorCode { INVALID_REQUEST, QUERY_FAILED, TABLEGEN_INVALID_INPUT_INDEX, TABLEGEN_CIRCULAR_DEPENDENCY };

struct Error {
    /// The error code
    ErrorCode code_;
    /// The message (if any)
    std::string message_buffer_;
    /// The message
    const char *message_;

    /// Constructor
    Error(ErrorCode code) : code_(code), message_(nullptr), message_buffer_() {}
    /// Constructor
    Error(ErrorCode code, const char *msg) : code_(code), message_(msg), message_buffer_() {}
    /// Constructor
    Error(ErrorCode code, std::string msg) : code_(code), message_buffer_(move(msg)), message_(message_buffer_.c_str()) {}

    /// Get the status code
    auto code() const { return code_; }
    /// Get the message
    auto *message() const { return message_; }
};

template <typename V> struct Expected {
    /// The data
    std::variant<V, Error> data_;
    /// Constructor
    Expected(V &&v = {}) : data_(std::move(v)) {}
    /// Constructor
    Expected(Error &&e) : data_(std::move(e)) {}
    /// Constructor
    Expected(const Error &e) : data_(e) {}
    /// Constructor
    template <typename... T> Expected(ErrorCode code, T... vs) : data_(Error{code, vs...}) {}
    /// Is ok?
    auto IsOk() const { return std::holds_alternative<V>(data_); }
    /// Is an error?
    auto IsErr() const { return std::holds_alternative<Error>(data_); }
    /// Get the value
    auto &value() const {
        assert(IsOk());
        return std::get<V>(data_);
    }
    /// Get the error
    auto &err() const {
        assert(IsErr());
        return std::get<Error>(data_);
    }
    /// Bool operator
    operator bool() const { return IsOk(); }
    /// Dereference operator
    auto &operator*() const { return value(); }
};
using ExpectedSignal = Expected<std::monostate>;

template <typename V> struct ExpectedBuffer {
    /// The data
    std::variant<flatbuffers::DetachedBuffer, Error> data_;
    /// Constructor
    ExpectedBuffer(flatbuffers::DetachedBuffer data) : data_(std::move(data)) {}
    /// Constructor
    ExpectedBuffer(Error &&e) : data_(std::move(e)) {}
    /// Constructor
    ExpectedBuffer(const Error &e) : data_(e) {}
    /// Constructor
    template <typename... T> ExpectedBuffer(ErrorCode code, T... vs) : data_(Error{code, vs...}) {}
    /// Is ok?
    auto IsOk() const { return std::holds_alternative<flatbuffers::DetachedBuffer>(data_); }
    /// Is an error?
    auto IsErr() const { return std::holds_alternative<Error>(data_); }
    /// Get the result
    auto &value() const {
        assert(IsOk());
        auto &buffer = std::get<flatbuffers::DetachedBuffer>(data_);
        return *flatbuffers::GetRoot<V>(buffer.data());
    }
    /// Get the error
    auto &err() const {
        assert(IsErr());
        return std::get<Error>(data_);
    }
    /// Bool operator
    operator bool() const { return IsOk(); }
    /// Dereference operator
    auto &operator*() const { return value(); }
    /// Get buffer
    auto &&ReleaseBuffer() {
        IsOk();
        return std::move(std::get<0>(data_));
    }
    /// Get buffer
    auto &&ReleaseError() {
        IsErr();
        return std::move(std::get<1>(data_));
    }
};

template <typename V> struct ExpectedBufferRef {
    /// The data
    std::variant<const flatbuffers::DetachedBuffer*, Error> data_;
    /// Constructor
    ExpectedBufferRef(const flatbuffers::DetachedBuffer& data) : data_(&data) {}
    /// Constructor
    ExpectedBufferRef(Error &&e) : data_(std::move(e)) {}
    /// Constructor
    ExpectedBufferRef(const Error &e) : data_(e) {}
    /// Constructor
    template <typename... T> ExpectedBufferRef(ErrorCode code, T... vs) : data_(Error{code, vs...}) {}
    /// Is ok?
    auto IsOk() const { return std::holds_alternative<const flatbuffers::DetachedBuffer*>(data_); }
    /// Is an error?
    auto IsErr() const { return std::holds_alternative<Error>(data_); }
    /// Get the result
    auto &value() const {
        assert(IsOk());
        auto buffer = std::get<const flatbuffers::DetachedBuffer*>(data_);
        return *flatbuffers::GetRoot<V>(buffer->data());
    }
    /// Get the error
    auto &err() const {
        assert(IsErr());
        return std::get<Error>(data_);
    }
    /// Bool operator
    operator bool() const { return IsOk(); }
    /// Dereference operator
    auto &operator*() const { return value(); }
    /// Get the buffer
    nonstd::span<const char> GetBuffer() {
        auto buffer = std::get<const flatbuffers::DetachedBuffer*>(data_);
        return {reinterpret_cast<const char*>(buffer->data()), buffer->size()};
    }
    /// Get buffer
    auto &&ReleaseError() {
        IsErr();
        return std::move(std::get<1>(data_));
    }
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_EXPECTED_H_

