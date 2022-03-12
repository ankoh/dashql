#include "dashql/analyzer/input_value.h"

#include "dashql/analyzer/sql_scalar.h"

namespace dashql {

/// Default constructor
InputValue::InputValue(size_t statement_id, std::shared_ptr<arrow::Scalar> value)
    : statement_id(statement_id), value(std::move(value)) {}
/// Copy constructor
InputValue::InputValue(const InputValue& other) : statement_id(other.statement_id), value(other.value) {}
/// Move constructor
InputValue::InputValue(InputValue&& other) : statement_id(other.statement_id), value(std::move(other.value)) {}

/// Copy assignment
InputValue& InputValue::operator=(const InputValue& other) {
    statement_id = other.statement_id;
    value = other.value;
    return *this;
}
/// Move assignment
InputValue& InputValue::operator=(InputValue&& other) {
    statement_id = other.statement_id;
    value = std::move(other.value);
    return *this;
}

/// Compare two parameter values
bool InputValue::operator==(const InputValue& other) const {
    return statement_id == other.statement_id && value == other.value;
}
/// Compare two parameter values
bool InputValue::operator!=(const InputValue& other) const {
    return statement_id != other.statement_id || value != other.value;
}

/// Pack the parameter value
arrow::Result<flatbuffers::Offset<proto::analyzer::InputValue>> InputValue::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    ARROW_ASSIGN_OR_RAISE(auto v, PackArrowScalar(builder, *value));
    proto::analyzer::InputValueBuilder p{builder};
    p.add_statement_id(statement_id);
    p.add_value(v);
    return p.Finish();
}

/// Read from a parameter value
arrow::Result<InputValue> InputValue::UnPack(const proto::analyzer::InputValue& b) {
    InputValue p;
    p.statement_id = b.statement_id();
    if (auto v = b.value(); !!v) {
        ARROW_ASSIGN_OR_RAISE(p.value, UnpackArrowScalar(*v));
    }
    return p;
}

}  // namespace dashql
