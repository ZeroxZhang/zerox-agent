# RC04 Decision: OS-Enforced Process Sandbox

Status: Accepted

Date: 2026-08-14

## Context

Zerox currently analyzes and authorizes Shell/test commands but starts the
approved command directly in the host process world. A parser or policy defect
therefore has no kernel-enforced second boundary.

The model-reachable arbitrary-process entries are:

1. `shell_exec`
2. `test_run`
3. opt-in stdio MCP servers (`ZEROX_ENABLE_SKILL_MCP=1`)

Fixed-argv native Git/code helpers, trusted release scripts, internal
ToolWorker, and non-model workspace management are not arbitrary command
surfaces and remain outside RC04.

Script-backed manifest tools are already not registered as model tools until an
OS sandbox exists. Their separate activation remains deferred.

## Platform Facts

The reviewed host is macOS 26.6.1 arm64 and ships
`/usr/bin/sandbox-exec`.

Real kernel probes on 2026-08-14 established:

- a Seatbelt profile with canonical workspace write grant allowed a write
  inside the workspace;
- the same profile denied a write to an adjacent canonical directory with
  `operation not permitted`;
- `(deny network*)` denied a TCP connection to a local listener with `EPERM`.

`/tmp` and the Darwin user temp path resolve through symlinks on macOS. Every
granted root must use native `realpath` identity before it enters SBPL.

## Decision

Add a `ProcessSandboxProvider` seam and a macOS Seatbelt implementation.

The provider accepts an argv vector and a process policy, returning a confined
argv vector. Consumers always use `shell: false` around the returned vector.

```text
authorized ToolRuntime request
  -> process policy derived from canonical AgentRunContext
  -> ProcessSandboxProvider.confine(argv, policy)
  -> /usr/bin/sandbox-exec -p <SBPL> -- <argv>
  -> spawn/execFile with no unconfined retry
```

The Seatbelt file profile is:

```text
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (literal "/dev/null"))
<canonical writable-root grants>
<optional deny network*>
```

## Enforcement Claims

RC04 claims only what it enforces:

- **file writes:** kernel restricted to canonical writable roots;
- **network none:** kernel denies network operations;
- **reads:** allow-default, still governed by typed tools and authorization but
  not claimed as kernel-isolated;
- **approved domains/task policy:** authorization remains authoritative;
  Seatbelt cannot enforce DNS-domain allowlists;
- **process/CPU/memory:** not constrained by this profile.

This is a material trust improvement without overstating it as a container.

## Policy Mapping

For `shell_exec` and `test_run`:

- `read_only` grants no writable root except `/dev/null`;
- `workspace_write` grants canonical `workspaceRoot`,
  `extraWriteRoots`, `/tmp`, and `os.tmpdir()`;
- `network: none` adds `(deny network*)`;
- other network modes rely on existing shell-plan authorization;
- `extraReadRoots` do not create write grants;
- `allowWorkspaceEscape` never means unrestricted writes; only declared
  `extraWriteRoots` are granted.

For stdio MCP:

- the server is opt-in and globally persistent, so it cannot safely inherit a
  per-run workspace;
- it receives a dedicated MCP state root plus temp write grants;
- it may use network because external integration is its purpose;
- it receives no user-workspace write grant.

## Availability And Rollback

Add `ZEROX_PROCESS_SANDBOX` with values:

- `required` (default): probe Seatbelt once and fail closed if unusable;
- `deny`: disable model-reachable process execution without running it
  unconfined.

There is no production `unconfined` mode. The feature rollback is `deny`, which
preserves all non-process tools and avoids weakening the trust boundary.

Non-macOS platforms report the provider unavailable in RC04 and deny these
process entries. Linux/Windows backends require their own reviewed substrates.

## Consumer Behavior

- Sandbox unavailability returns structured
  `process_sandbox_unavailable`.
- Kernel denial returns the command's non-zero result and includes the backend,
  enforcement facts, and denial classification.
- Timeout/cancellation continues to terminate and drain the confined process
  tree.
- A runner failure never retries the raw command.
- MCP reconnects reuse the same confined launch policy.

## Verification

1. Pure profile tests for escaping, canonicalization, policy mapping, and
   fail-closed modes.
2. Real macOS world-effect tests:
   - workspace write succeeds;
   - adjacent and symlink-mediated writes fail;
   - read-only write fails;
   - network-none TCP connect fails.
3. Shell/test integration tests verify wrapped argv and no fallback.
4. MCP stdio tests verify every connect/reconnect uses the provider.
5. A production-source sensor requires the container to inject the provider.

## Rollback

Set `ZEROX_PROCESS_SANDBOX=deny`. This removes Shell, test, and stdio MCP
execution but never restores direct host execution. No persistence or user-data
migration is involved.

## Deferred Work

- Linux bubblewrap/Landlock and Windows restricted-token backends.
- read-path kernel isolation.
- per-workspace MCP process pools.
- private per-run temp mounts/directories.
- CPU, memory, PID, and syscall limits.
- script-backed model tools.
