// Copyright (c) 2020 The DashQL Authors

#include "dashql/jmespath/jmespath.h"

#include "dashql/common/wasm_response.h"

namespace dashql {

Expected<std::string> JMESPath::Evaluate(std::string_view input, std::string_view expression) { return {""}; }

}  // namespace dashql
