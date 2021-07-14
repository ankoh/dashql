// Copyright (c) 2020 The DashQL Authors

#include "dashql/jmespath/jmespath.h"

#include "dashql/common/wasm_response.h"
#include "jmespath/exceptions.h"
#include "jmespath/expression.h"
#include "jmespath/jmespath.h"
#include "nlohmann/json.hpp"

namespace jp = jmespath;
namespace nl = nlohmann;

namespace dashql {

arrow::Result<std::string> JMESPath::Evaluate(const char* expression, const char* input) {
    try {
        jp::Expression jpe{expression};
        auto doc = nl::json::parse(input);
        auto result = jp::search(jpe, doc);
        return result.dump();
    } catch (nl::json::type_error& e) {
        return arrow::Status::Invalid(e.what());
    } catch (nl::json::parse_error& e) {
        return arrow::Status::Invalid(e.what());
    } catch (jp::Exception& e) {
        return arrow::Status::Invalid(e.what());
    } catch (std::exception& e) {
        return arrow::Status::Invalid(e.what());
    }
}

}  // namespace dashql
