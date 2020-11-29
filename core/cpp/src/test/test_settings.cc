#include "dashql/test/test_settings.h"

namespace dashql {
namespace test {

TestSettings& TestSettings::Get() {
    static TestSettings global_settings;
    return global_settings;
}

}  // namespace test
}  // namespace dashql
