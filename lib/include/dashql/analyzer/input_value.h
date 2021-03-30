// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_INPUT_VALUE_H_
#define INCLUDE_DASHQL_ANALYZER_INPUT_VALUE_H_

#include <iostream>
#include <optional>
#include <sstream>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "dashql/analyzer/value.h"
#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/common/union_find.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// An parameter value
struct InputValue {
    /// The statement id
    size_t statement_id;
    /// The value
    Value value;

    /// Constructor
    InputValue(size_t statement_id = 0, Value value = {});
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
    flatbuffers::Offset<proto::analyzer::InputValue> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Read from a parameter value
    static InputValue UnPack(const proto::analyzer::InputValue&);
};

}  // namespace dashql

#endif
