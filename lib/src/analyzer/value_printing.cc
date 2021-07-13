#include "dashql/analyzer/value_printing.h"

#include <sstream>

#include "arrow/type_fwd.h"

namespace dashql {

std::string PrintScript(const arrow::Scalar& scalar) {
    switch (scalar.type->id()) {
        case arrow::Type::STRING: {
            std::stringstream buffer;
            buffer << "\'";
            buffer << scalar.ToString();
            buffer << "\'";
            return buffer.str();
        }
        default:
            return scalar.ToString();
    }
}

}  // namespace dashql
