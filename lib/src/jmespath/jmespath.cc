// Copyright (c) 2020 The DashQL Authors

#include "dashql/jmespath/jmespath.h"

#include "dashql/common/wasm_response.h"
#include "jmespath/expression.h"
#include "jmespath/jmespath.h"
#include "nlohmann/json.hpp"

namespace jp = jmespath;
namespace nl = nlohmann;

namespace dashql {

arrow::Result<std::string> JMESPath::Evaluate(const char* input, const char* expression) {
    jp::Expression jpe{input};
    try {
        auto doc = nl::json::parse(input);
        auto result = jp::search(jpe, doc);
        return result.dump();
    } catch (nl::json::parse_error& e) {
        return arrow::Status::Invalid(e.what());
    } catch (...) {
        return arrow::Status::Invalid("evaluation failed");
    }
}

}  // namespace dashql
