// v3.6.0: Shared named constants for magic numbers used across the codebase
// (S2-34, QA-21). Each constant is documented with its rationale and the system
// parameter it governs. Import from here instead of scattering literals.

/** Maximum age (ms) of a pending continuation Map entry before TTL eviction. */
export const PENDING_CONTINUATION_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Maximum number of events retained in the KernelEventBus ring buffer. */
export const KERNEL_EVENT_BUS_MAX_EVENTS = 1000;

/** WAL checkpoint interval (in number of write operations). */
export const WAL_CHECKPOINT_WRITE_INTERVAL = 1000;

/** Default per-tool execution timeout in ms. */
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000; // 2 minutes

/** Maximum per-tool execution timeout in ms. */
export const MAX_TOOL_TIMEOUT_MS = 600_000; // 10 minutes

/** Minimum per-tool execution timeout in ms. */
export const MIN_TOOL_TIMEOUT_MS = 25;

/** SSE stream idle timeout in ms — if no data arrives within this window the
 *  stream is considered dead and the loop exits (CORE-02, NET-14). */
export const SSE_READ_IDLE_TIMEOUT_MS = 30_000;

/** Tool approval timeout in ms — if the user doesn't respond within this window
 *  the request is auto-denied (CORE-10). */
export const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Default HTTP request timeout for non-streaming fetch in ms. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes

/** Maximum response body size for web_fetch in bytes (5 MB). */
export const WEB_FETCH_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Maximum text length returned by web_fetch before truncation. */
export const WEB_FETCH_MAX_TEXT_CHARS = 24_000;

/** Default tool result offload threshold in characters. Results larger than this
 *  are written to disk and replaced with a reference. */
export const TOOL_RESULT_OFFLOAD_THRESHOLD_CHARS = 12_000;

/** Maximum number of web_search results returned. */
export const WEB_SEARCH_MAX_RESULTS = 8;

/** Maximum chat messages per session before compaction is triggered. */
export const MAX_MESSAGES_PER_SESSION = 500;

/** Default agent loop max turns when not specified by the caller. */
export const DEFAULT_AGENT_LOOP_MAX_TURNS = 4;

/** Maximum file size (bytes) for text file search to avoid memory issues. */
export const FILE_SEARCH_MAX_FILE_BYTES = 256 * 1024;

/** MCP request timeout in ms. */
export const MCP_REQUEST_TIMEOUT_MS = 30_000;

/** MCP process auto-restart maximum attempts. */
export const MCP_MAX_RESTART_ATTEMPTS = 3;

/** Memory maintenance interval in ms. */
export const MEMORY_MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** Task scheduler poll interval in ms. */
export const TASK_SCHEDULER_INTERVAL_MS = 60 * 1000; // 1 minute

/** Token budget safety margin as fraction of model maxTokens. */
export const CONTEXT_TOKEN_BUDGET_RATIO = 0.7;

/** Network connect timeout in ms (separate from body timeout, NET-01). */
export const NETWORK_CONNECT_TIMEOUT_MS = 30_000;

/** Network body timeout in ms for large responses (NET-01). */
export const NETWORK_BODY_TIMEOUT_MS = 300_000;
