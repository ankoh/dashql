#pragma once

#include <cstddef>
#include <cstdint>

#if defined(_WIN32)
#define DASHQL_SHELL_EXPORT __declspec(dllexport)
#else
#define DASHQL_SHELL_EXPORT __attribute__((visibility("default")))
#endif

namespace dashql {
class Catalog;
}

extern "C" {

struct DashQLShell;

enum DashQLShellStatus : uint32_t {
    DASHQL_SHELL_OK = 0,
    DASHQL_SHELL_INVALID_ARGUMENT = 1,
    DASHQL_SHELL_ARROW_ERROR = 2,
    DASHQL_SHELL_INTERNAL_ERROR = 3,
    DASHQL_SHELL_PENDING = 4,
    DASHQL_SHELL_STALE_EFFECT = 5,
    DASHQL_SHELL_BUSY = 6,
};

enum DashQLShellEffectCompletionStatus : uint32_t {
    DASHQL_SHELL_EFFECT_SUCCESS = 0,
    DASHQL_SHELL_EFFECT_ERROR = 1,
    DASHQL_SHELL_EFFECT_CANCELLED = 2,
};

enum DashQLShellPromptInputKey : uint32_t {
    DASHQL_SHELL_INPUT_TEXT = 0,
    DASHQL_SHELL_INPUT_ENTER = 1,
    DASHQL_SHELL_INPUT_FORCE_SUBMIT = 2,
    DASHQL_SHELL_INPUT_TAB = 3,
    DASHQL_SHELL_INPUT_BACKSPACE = 4,
    DASHQL_SHELL_INPUT_DELETE = 5,
    DASHQL_SHELL_INPUT_LEFT = 6,
    DASHQL_SHELL_INPUT_RIGHT = 7,
    DASHQL_SHELL_INPUT_HISTORY_PREVIOUS = 8,
    DASHQL_SHELL_INPUT_HISTORY_NEXT = 9,
    DASHQL_SHELL_INPUT_CANCEL = 10,
    DASHQL_SHELL_INPUT_ESCAPE = 11,
    DASHQL_SHELL_INPUT_UP = 12,
    DASHQL_SHELL_INPUT_DOWN = 13,
    DASHQL_SHELL_INPUT_START = 14,
    DASHQL_SHELL_INPUT_END = 15,
};

enum DashQLShellPromptInputAction : uint32_t {
    DASHQL_SHELL_INPUT_NONE = 0,
    DASHQL_SHELL_INPUT_SUBMIT = 1,
    DASHQL_SHELL_INPUT_COMPLETE = 2,
    DASHQL_SHELL_INPUT_EXIT = 3,
};

struct DashQLShellResult {
    uint32_t status;
    uint32_t data_length;
    const uint8_t* data_ptr;
    void* owner_ptr;
};

struct DashQLShellPromptResult {
    uint32_t status;
    uint32_t revision_low;
    uint32_t revision_high;
    uint32_t cursor_byte_offset;
    uint32_t text_length;
    const uint8_t* text_ptr;
    uint32_t message_length;
    const uint8_t* message_ptr;
    void* owner_ptr;
    uint32_t action;
};

struct DashQLShellTerminalResult {
    uint32_t status;
    uint32_t action;
    uint32_t data_length;
    const uint8_t* data_ptr;
    void* owner_ptr;
};

struct DashQLShellCompletionResult {
    uint32_t count;
    const void* candidates_ptr;
    void* owner_ptr;
};

struct DashQLShellCompletionCandidate {
    uint32_t display_text_length;
    const uint8_t* display_text_ptr;
    uint32_t completion_text_length;
    const uint8_t* completion_text_ptr;
    uint32_t target_offset;
    uint32_t target_length;
};

#if UINTPTR_MAX == UINT32_MAX
static_assert(sizeof(DashQLShellResult) == 16);
static_assert(sizeof(DashQLShellPromptResult) == 40);
static_assert(sizeof(DashQLShellTerminalResult) == 20);
static_assert(sizeof(DashQLShellCompletionResult) == 12);
static_assert(sizeof(DashQLShellCompletionCandidate) == 24);
#endif

DASHQL_SHELL_EXPORT DashQLShell* dashql_shell_new(dashql::Catalog* catalog, uint32_t terminal_columns);
DASHQL_SHELL_EXPORT void dashql_shell_destroy(DashQLShell* shell);
DASHQL_SHELL_EXPORT void dashql_shell_resize(DashQLShell* shell, uint32_t terminal_columns);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_commands_set(
    DashQLShell* shell,
    const uint8_t* commands,
    size_t commands_length);

DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_set(
    DashQLShell* shell,
    const uint8_t* text,
    size_t text_length,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_insert(
    DashQLShell* shell,
    const uint8_t* text,
    size_t text_length,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_move_left(DashQLShell* shell, DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_move_right(DashQLShell* shell, DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_delete_backward(
    DashQLShell* shell,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_delete_forward(
    DashQLShell* shell,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_complete(
    DashQLShell* shell,
    size_t limit,
    DashQLShellCompletionResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_apply_completion(
    DashQLShell* shell,
    const DashQLShellCompletionCandidate* candidate,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_consume(
    DashQLShell* shell,
    uint32_t key,
    const uint8_t* text,
    size_t text_length,
    DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_prompt_submit(DashQLShell* shell, DashQLShellResult* result);
DASHQL_SHELL_EXPORT void dashql_shell_prompt_result_destroy(DashQLShellPromptResult* result);
DASHQL_SHELL_EXPORT void dashql_shell_completion_result_destroy(DashQLShellCompletionResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_terminal_open(
    DashQLShell* shell,
    const uint8_t* prompt,
    size_t prompt_length,
    bool welcome,
    DashQLShellTerminalResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_terminal_consume(
    DashQLShell* shell,
    uint32_t key,
    const uint8_t* text,
    size_t text_length,
    DashQLShellTerminalResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_terminal_finish_query(
    DashQLShell* shell,
    const uint8_t* output,
    size_t output_length,
    bool error,
    DashQLShellTerminalResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_terminal_status(
    DashQLShell* shell,
    const uint8_t* message,
    size_t message_length,
    DashQLShellTerminalResult* result);
DASHQL_SHELL_EXPORT void dashql_shell_terminal_result_destroy(DashQLShellTerminalResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_history_export(DashQLShell* shell, DashQLShellResult* result);
DASHQL_SHELL_EXPORT uint32_t dashql_shell_history_import(
    DashQLShell* shell,
    const uint8_t* data,
    size_t data_length,
    DashQLShellResult* result);

DASHQL_SHELL_EXPORT uint32_t dashql_shell_start_query(
    DashQLShell* shell,
    const uint8_t* query,
    size_t query_length,
    DashQLShellResult* result);

DASHQL_SHELL_EXPORT uint32_t dashql_shell_complete_effect(
    DashQLShell* shell,
    uint32_t effect_id_low,
    uint32_t effect_id_high,
    uint32_t completion_status,
    const uint8_t* data,
    size_t data_length,
    DashQLShellResult* result);

DASHQL_SHELL_EXPORT uint32_t dashql_shell_cancel_effect(
    DashQLShell* shell,
    uint32_t effect_id_low,
    uint32_t effect_id_high,
    DashQLShellResult* result);

DASHQL_SHELL_EXPORT void dashql_shell_result_destroy(DashQLShellResult* result);

}
