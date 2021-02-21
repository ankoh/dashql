// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PROGRAM_LINTER_H_
#define INCLUDE_DASHQL_ANALYZER_PROGRAM_LINTER_H_

#include <sstream>
#include <variant>

#include "dashql/common/span.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

enum class LinterMessageCode {
    OPTION_ALTERNATIVE,
    OPTION_ALTERNATIVE_STYLE,
    OPTION_REDUNDANT,
};

struct LinterMessage {
    /// The error code
    LinterMessageCode code_;
    /// The message (if any)
    std::string message_buffer_;
    /// The message
    const char *message_;
    /// The node
    size_t node_id_;

    /// Constructor
    LinterMessage(LinterMessageCode code, size_t node_id)
        : code_(code), message_(nullptr), message_buffer_(), node_id_(node_id) {}

    /// Get the status code
    auto code() const { return code_; }
    /// Get the message
    auto *message() const { return message_; }

    LinterMessage &operator<<(const std::string &v) {
        message_buffer_ += v;
        message_ = message_buffer_.c_str();
        return *this;
    }
    LinterMessage &operator<<(std::string_view v) {
        message_buffer_ += v;
        message_ = message_buffer_.c_str();
        return *this;
    }
    LinterMessage &operator<<(const char *v) {
        message_buffer_ += v;
        message_ = message_buffer_.c_str();
        return *this;
    }
    LinterMessage &operator<<(uint32_t v) {
        message_buffer_ += std::to_string(v);
        message_ = message_buffer_.c_str();
        return *this;
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_PROGRAM_LINTER_H_
