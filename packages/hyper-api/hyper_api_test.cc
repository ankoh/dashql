#include <hyperapi/hyperapi.hpp>

#include <cstdlib>
#include <filesystem>
#include <string>

#include "gtest/gtest.h"

TEST(HyperApiTest, StartsProcessAndExecutesQuery) {
    const char* hyperd_binary = std::getenv("HYPERD_BINARY");
    ASSERT_NE(hyperd_binary, nullptr);

    const auto hyperd_dir = std::filesystem::path{hyperd_binary}.parent_path();
    hyperapi::HyperProcess process{
        hyperd_dir.string(),
        hyperapi::Telemetry::DoNotSendUsageDataToTableau,
        "dashql-hyper-api-test",
        {{"log_config", ""}},
    };
    hyperapi::Connection connection{process.getEndpoint()};
    EXPECT_EQ(connection.executeScalarQuery<int64_t>("select 1"), 1);
}
