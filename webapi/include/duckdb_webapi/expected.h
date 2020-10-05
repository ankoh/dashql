// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_EXPECTED_H_
#define INCLUDE_DUCKDB_WEBAPI_EXPECTED_H_

#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"
#include "duckdb_webapi/common/span.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "flatbuffers/flatbuffers.h"
#include <variant>

namespace duckdb_webapi {

enum class ErrorCode { INVALID_REQUEST, QUERY_FAILED, TABLEGEN_INVALID_INPUT_INDEX, TABLEGEN_CIRCULAR_DEPENDENCY };

struct Error {
    /// The error code
    ErrorCode code;
    /// The message (if any)
    std::string messageBuffer;
    /// The message
    const char *message;

    /// Constructor
    Error(ErrorCode code) : code(code), message(nullptr), messageBuffer() {}
    /// Constructor
    Error(ErrorCode code, const char *msg) : code(code), message(msg), messageBuffer() {}
    /// Constructor
    Error(ErrorCode code, std::string msg) : code(code), messageBuffer(move(msg)), message(messageBuffer.c_str()) {}

    /// Get the message
    auto* getMessage() const { return message; }
};

template <typename V> struct Expected {
    /// The data
    std::variant<V, Error> data;
    /// Constructor
    Expected(V &&v = {}) : data(move(v)) {}
    /// Constructor
    Expected(Error &&e) : data(move(e)) {}
    /// Constructor
    template <typename... T> Expected(ErrorCode code, T... vs) : data(Error{code, vs...}) {}
    /// Is ok?
    auto &isOk() const { return std::holds_alternative<V>(data); }
    /// Is an error?
    auto &isErr() const { return std::holds_alternative<Error>(data); }
    /// Get the error
    auto &getErr() const {
        assert(isErr());
        return std::get<Error>(data);
    }
    /// Bool operator
    operator bool() const { return isOk(); }
    /// Dereference operator
    auto &operator*() const { return std::get<V>(data); }
};
using ExpectedSignal = Expected<std::monostate>;

template <typename V> struct ExpectedBuffer {
    /// The data
    std::variant<flatbuffers::DetachedBuffer, Error> data;
    /// Constructor
    ExpectedBuffer(flatbuffers::DetachedBuffer data) : data(move(data)) {}
    /// Constructor
    ExpectedBuffer(Error &&e) : data(move(e)) {}
    /// Constructor
    template <typename... T> ExpectedBuffer(ErrorCode code, T... vs) : data(Error{code, vs...}) {}
    /// Is ok?
    auto &isOk() const { return std::holds_alternative<V *>(data); }
    /// Is an error?
    auto &isErr() const { return std::holds_alternative<Error>(data); }
    /// Get the error
    auto &getErr() const {
        assert(isErr());
        return std::get<Error>(data);
    }
    /// Bool operator
    operator bool() const { return isOk(); }
    /// Dereference operator
    auto &operator*() const { return *flatbuffers::GetRoot<V>(data); }
    /// Get buffer
    auto &&releaseBuffer() {
        isOk();
        return move(std::get<0>(data));
    }
    /// Get buffer
    auto &&releaseError() {
        isErr();
        return move(std::get<1>(data));
    }
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_EXPECTED_H_

