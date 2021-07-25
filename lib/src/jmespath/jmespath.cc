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

arrow::Result<std::string> JMESPath::Evaluate(const char* expression, std::string_view input) {
    try {
        jp::Expression jpe{expression};
        auto doc = nl::json::parse(input);
        auto result = jp::search(jpe, doc);
        return result.dump();
    } catch (const nl::json::type_error& e) {
        return arrow::Status::Invalid(e.what());
    } catch (const nl::json::parse_error& e) {
        return arrow::Status::Invalid(e.what());
    } catch (const jp::SyntaxError& e) {
        auto loc = boost::get_error_info<jp::InfoSyntaxErrorLocation>(e);
        std::stringstream out;
        if (const auto* expr = boost::get_error_info<jmespath::InfoSearchExpression>(e)) {
            out << "Failed parsing expression: " << *expr << std::endl;
        }
        if (const long* location = boost::get_error_info<jmespath::InfoSyntaxErrorLocation>(e)) {
            out << "Syntax error at position: " << *location << std::endl;
        }
        return arrow::Status::Invalid(out.str());
    } catch (const jp::Exception& e) {
        return arrow::Status::Invalid(e.what());
    } catch (...) {
        return arrow::Status::Invalid("unknown exception");
    }
}

}  // namespace dashql
