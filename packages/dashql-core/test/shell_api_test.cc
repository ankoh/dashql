#include "dashql/shell/api.h"

#include <string>

#include "dashql/catalog.h"
#include "gtest/gtest.h"

namespace {

TEST(ShellApiTest, EditsAndSubmitsPrompt) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string query = "select 1";
    EXPECT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), query);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size());
    EXPECT_EQ(prompt.revision_low, 1);
    dashql_shell_prompt_result_destroy(&prompt);

    EXPECT_EQ(dashql_shell_prompt_move_left(shell, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.cursor_byte_offset, query.size() - 1);
    dashql_shell_prompt_result_destroy(&prompt);

    const std::string insertion = "0";
    EXPECT_EQ(dashql_shell_prompt_insert(shell, reinterpret_cast<const uint8_t*>(insertion.data()), insertion.size(),
                                         &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), "select 01");
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    EXPECT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    ASSERT_GE(operation.data_length, 16u);
    EXPECT_EQ(
        (std::string_view{reinterpret_cast<const char*>(operation.data_ptr + 16), operation.data_length - 16}),
        "select 01");
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, ReturnsCompletionCandidates) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string query = "sel";
    ASSERT_EQ(dashql_shell_prompt_set(shell, reinterpret_cast<const uint8_t*>(query.data()), query.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellCompletionResult completions{};
    EXPECT_EQ(dashql_shell_prompt_complete(shell, 10, &completions), DASHQL_SHELL_OK);
    EXPECT_GT(completions.count, 0u);
    EXPECT_NE(completions.candidates_ptr, nullptr);
    dashql_shell_completion_result_destroy(&completions);
    dashql_shell_destroy(shell);
}

TEST(ShellApiTest, DrivesPromptInteractionAndHistory) {
    dashql::Catalog catalog;
    auto* shell = dashql_shell_new(&catalog, 80);
    ASSERT_NE(shell, nullptr);

    DashQLShellPromptResult prompt{};
    const std::string incomplete = "select 1";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(incomplete.data()), incomplete.size(), &prompt),
              DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    dashql_shell_prompt_result_destroy(&prompt);

    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_NONE);
    EXPECT_EQ((std::string_view{reinterpret_cast<const char*>(prompt.text_ptr), prompt.text_length}), "select 1\n");
    dashql_shell_prompt_result_destroy(&prompt);

    const std::string terminator = ";";
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_TEXT,
                                          reinterpret_cast<const uint8_t*>(terminator.data()), terminator.size(), &prompt),
              DASHQL_SHELL_OK);
    dashql_shell_prompt_result_destroy(&prompt);
    ASSERT_EQ(dashql_shell_prompt_consume(shell, DASHQL_SHELL_INPUT_ENTER, nullptr, 0, &prompt), DASHQL_SHELL_OK);
    EXPECT_EQ(prompt.action, DASHQL_SHELL_INPUT_SUBMIT);
    dashql_shell_prompt_result_destroy(&prompt);

    DashQLShellResult operation{};
    ASSERT_EQ(dashql_shell_prompt_submit(shell, &operation), DASHQL_SHELL_PENDING);
    dashql_shell_result_destroy(&operation);
    dashql_shell_destroy(shell);
}

}  // namespace
