#include "dashql/analyzer/parameter_value.h"

namespace dashql {

/// Compare two parameter values
bool ParameterValue::operator==(const ParameterValue& other) const {
    return statement_id == other.statement_id && value == other.value;
}

/// Compare two parameter values
bool ParameterValue::operator!=(const ParameterValue& other) const {
    return statement_id != other.statement_id || value != other.value;
}

/// Pack the parameter value
flatbuffers::Offset<proto::analyzer::ParameterValue> ParameterValue::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    auto v = value.Pack(builder);
    proto::analyzer::ParameterValueBuilder p{builder};
    p.add_statement_id(statement_id);
    p.add_value(v);
    return p.Finish();
}

/// Read from a parameter value
ParameterValue ParameterValue::UnPack(const proto::analyzer::ParameterValue& b) {
    ParameterValue p;
    p.statement_id = b.statement_id();
    if (auto v = b.value(); !!v) p.value = Value::UnPack(*v);
    return p;
}

}  // namespace dashql
