// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PARAMETER_VALUE_H_
#define INCLUDE_DASHQL_ANALYZER_PARAMETER_VALUE_H_

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
struct ParameterValue {
    /// The statement id
    size_t statement_id;
    /// The value
    Value value;

    /// Constructor
    ParameterValue(size_t statement_id = 0, Value value = {});
    /// Copy constructor
    ParameterValue(const ParameterValue& other);
    /// Move constructor
    ParameterValue(ParameterValue&& other);

    /// Copy assignment
    ParameterValue& operator=(const ParameterValue& other);
    /// Move assignment
    ParameterValue& operator=(ParameterValue&& other);

    /// Compare two parameter values
    bool operator==(const ParameterValue& other) const;
    /// Compare two parameter values
    bool operator!=(const ParameterValue& other) const;

    /// Pack the parameter value
    flatbuffers::Offset<proto::analyzer::ParameterValue> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Read from a parameter value
    static ParameterValue UnPack(const proto::analyzer::ParameterValue&);
};

}  // namespace dashql

#endif
