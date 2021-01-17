// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_EXPECTED_H_
#define INCLUDE_DASHQL_COMMON_EXPECTED_H_

#include <sstream>
#include <variant>

#include "dashql/common/span.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

enum class ErrorCode {
    CSV_PARSER_ERROR,
    FORMAT_FAILED,
    FORMAT_INVALID_INPUT,
    INTERNAL_ERROR,
    INVALID_REQUEST,
    NOT_IMPLEMENTED,
    QUERY_FAILED,
    TABLEGEN_CIRCULAR_DEPENDENCY,
    TABLEGEN_INVALID_INPUT_INDEX,
};

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
    Error(ErrorCode code, std::string msg)
        : code_(code), message_buffer_(move(msg)), message_(message_buffer_.c_str()) {}

    /// Get the status code
    auto code() const { return code_; }
    /// Get the message
    auto *message() const { return message_; }

    Error &operator<<(const std::string &v) {
        message_buffer_ += v;
        message_ = message_buffer_.c_str();
        return *this;
    }
    Error &operator<<(const char *v) {
        message_buffer_ += v;
        message_ = message_buffer_.c_str();
        return *this;
    }
    Error &operator<<(uint32_t v) {
        message_buffer_ += std::to_string(v);
        message_ = message_buffer_.c_str();
        return *this;
    }
};

template <typename Context> class ErrorBuilder {
   protected:
    using Callback = void (*)(Context *, Error &&);
    /// The state
    Context *context_;
    /// The error code
    ErrorCode error_code_;
    /// Ingore the error messages?
    bool ignore_;
    /// The callback
    Callback callback_;
    /// Message
    std::stringstream error_message_;

   public:
    /// Constructor
    ErrorBuilder(ErrorCode code, bool ignore, Context *context, Callback callback)
        : error_code_(code), ignore_(ignore), context_(context), callback_(callback) {}
    /// Destructor
    ~ErrorBuilder() {
        if (!ignore_) callback_(context_, Error{error_code_, error_message_.str()});
    }

    ErrorBuilder &operator<<(const std::string &v) {
        if (ignore_) return *this;
        error_message_ << v;
        return *this;
    }
    ErrorBuilder &operator<<(const char *v) {
        if (ignore_) return *this;
        error_message_ << v;
        return *this;
    }
    ErrorBuilder &operator<<(uint32_t v) {
        if (ignore_) return *this;
        error_message_ << v;
        return *this;
    }
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
    /// Get the error
    auto &err() {
        assert(IsErr());
        return std::get<Error>(data_);
    }
    /// Bool operator
    operator bool() const { return IsOk(); }
    /// Dereference operator
    auto &operator*() const { return value(); }
    /// Release the value
    auto &&ReleaseValue() {
        assert(IsOk());
        return std::move(std::get<V>(data_));
    }
    /// Release the value
    auto &&ReleaseError() {
        assert(IsErr());
        return std::move(std::get<Error>(data_));
    }

    static Expected<V> OK(V &&v = {}) { return Expected<V>(move(v)); }
};
using Signal = Expected<std::monostate>;

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
    std::variant<const flatbuffers::DetachedBuffer *, Error> data_;
    /// Constructor
    ExpectedBufferRef(const flatbuffers::DetachedBuffer &data) : data_(&data) {}
    /// Constructor
    ExpectedBufferRef(Error &&e) : data_(std::move(e)) {}
    /// Constructor
    ExpectedBufferRef(const Error &e) : data_(e) {}
    /// Constructor
    template <typename... T> ExpectedBufferRef(ErrorCode code, T... vs) : data_(Error{code, vs...}) {}
    /// Is ok?
    auto IsOk() const { return std::holds_alternative<const flatbuffers::DetachedBuffer *>(data_); }
    /// Is an error?
    auto IsErr() const { return std::holds_alternative<Error>(data_); }
    /// Get the result
    auto &value() const {
        assert(IsOk());
        auto buffer = std::get<const flatbuffers::DetachedBuffer *>(data_);
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
        auto buffer = std::get<const flatbuffers::DetachedBuffer *>(data_);
        return {reinterpret_cast<const char *>(buffer->data()), buffer->size()};
    }
    /// Get buffer
    auto &&ReleaseError() {
        IsErr();
        return std::move(std::get<1>(data_));
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_EXPECTED_H_
