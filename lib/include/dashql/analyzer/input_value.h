// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_INPUT_VALUE_H_
#define INCLUDE_DASHQL_ANALYZER_INPUT_VALUE_H_

#include <iostream>
#include <optional>
#include <sstream>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "arrow/scalar.h"
#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

/// An parameter value
struct InputValue {
    /// The statement id
    size_t statement_id;
    /// The value
    std::shared_ptr<arrow::Scalar> value;

    /// Constructor
    InputValue(size_t statement_id = 0, std::shared_ptr<arrow::Scalar> value = {});
    /// Copy constructor
    InputValue(const InputValue& other);
    /// Move constructor
    InputValue(InputValue&& other);

    /// Copy assignment
    InputValue& operator=(const InputValue& other);
    /// Move assignment
    InputValue& operator=(InputValue&& other);

    /// Compare two parameter values
    bool operator==(const InputValue& other) const;
    /// Compare two parameter values
    bool operator!=(const InputValue& other) const;

    /// Pack the parameter value
    arrow::Result<flatbuffers::Offset<proto::analyzer::InputValue>> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Read from a parameter value
    static arrow::Result<InputValue> UnPack(const proto::analyzer::InputValue&);
};

}  // namespace dashql

#endif
