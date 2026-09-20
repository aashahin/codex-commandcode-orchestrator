# codex-commandcode-orchestrator

An MCP bridge that lets **Codex delegate bounded tasks to [Command Code](https://commandcode.ai)**
(`cmd`) and review the result before it reaches your repository in the same spirit
as [`codex-opencode-orchestrator`](../codex-opencode-orchestrator).

Codex keeps planning, integration, review and final verification. Command Code workers do the bounded
model work in **isolated Git worktrees** and hand back a patch that Codex inspects and explicitly applies.

```
User → Codex → MCP bridge (commandcode_workers)
     → cmd -p --output-format json in a detached Git worktree
     → collected patch → Codex inspects & approves → your repository
```

## How it works

1. `cc_delegate` snapshots the repository — including staged, unstaged and untracked user edits — into
   a temporary commit and a **detached Git worktree** under `~/.cache/codex-commandcode-orchestrator/`.
2. The bridge moves the repo's `.commandcode/` and `.mcp.json` aside and writes a guardrail
   `.commandcode/settings.json` into the worktree.
3. It runs `cmd -p <contract> --output-format json` with that worktree as the working directory and
   reads the newline-delimited JSON stream for events and the final `result` frame.
4. The overlay is restored, the worker's changes are collected as a patch, and the worktree is kept
   until you discard it.
5. `cc_worker_diff` returns the patch in pages; once you have read all of it you receive a
   `reviewToken`. `cc_apply_worker_patch` applies the patch to your repository **without committing**.

Nothing auto-commits, auto-pushes or touches your working tree until you apply it.

## Worker permissions

| Task mode | Invocation | Effect |
| --- | --- | --- |
| `read_only` | `--permission-mode plan` | Engine-enforced read-only. Explorers and reviewers must use this. |
| `write_isolated` | `--yolo` | Full tool access, including shell, but confined to the throwaway worktree. |

`--yolo` is broad, so the bridge installs a **deny list** in the worktree that always wins, even under
bypass:

```
Edit(.git), Edit(.git/**), Write(.git/**)
Edit(~/.commandcode/**), Edit(~/.codex/**), Edit(~/.ssh/**), Edit(~/.aws/**), Edit(~/.gnupg/**)
Shell(git push:*), Shell(git remote add:*), Shell(git remote set-url:*), Shell(git worktree:*)
Shell(git reset --hard:*), Shell(git clean:*), Shell(git update-ref:*), Shell(sudo:*)
```

Set `"guardrails": false` in the config to drop the overlay entirely.

Because workers can run shell, they may report real build and test output. Every claim is returned as
`workerTestClaims` with `independentlyVerified: false` — Codex still runs the authoritative checks
against the applied patch.

`read_only` is stricter than it sounds: plan mode denies *any* command it classifies as mutating, which
in practice includes interpreters such as `node --check`. A read-only worker can read and search freely
but should be expected to report verification commands as not run, and Codex owns those checks. Use
`write_isolated` when a worker genuinely needs to execute something.

## Tools

| Tool | Purpose |
| --- | --- |
| `cc_health` | Command Code binary and version, bridge config, worker counts, routing, last live probe |
| `cc_models` | Model catalog with context, advertised reasoning efforts and minimum plan, plus role routing |
| `cc_delegate` | Run one worker in an isolated worktree |
| `cc_delegate_parallel` | Run 1–16 independent workers with bounded concurrency |
| `cc_worker_diff` | Inspect a worker patch, paginated, with a `reviewToken` once fully read |
| `cc_apply_worker_patch` | Apply a fully inspected patch to your repository |
| `cc_discard_worker` | Tear down a worker; unapplied patches are preserved unless you discard them |
| `cc_cancel_worker` | Terminate a running worker's process group |
| `cc_list_workers` | Recover durable worker state after compaction or a restart |

## Install

```sh
bun install
bun test && bun run typecheck
bun run install-local        # merges [mcp_servers.commandcode_workers] into ~/.codex/config.toml
codex mcp get commandcode_workers
```

Restart Codex afterwards. `install-local` also merges a marker-fenced section into `~/.codex/AGENTS.md`
so Codex knows when to route work here, and writes `~/.local/bin/codex-commandcode-doctor`. Any file it
changes is backed up to `<file>.before-orchestrator-<timestamp>` first.

## Configuration

`~/.config/codex-commandcode-orchestrator/config.json` (override with `CC_BRIDGE_CONFIG`):

```json
{
  "routing": { "implementer": ["moonshotai/Kimi-K2.7-Code"] },
  "parallelism": 2,
  "timeoutSeconds": 900,
  "maxTurns": 100,
  "guardrails": true,
  "extraArgs": [],
  "toolsEnable": []
}
```

| Key | Default | Notes |
| --- | --- | --- |
| `routing` | per-role defaults | Ordered candidate ids; the first entry is used. Never silently downgraded. |
| `parallelism` | `2` | Concurrent workers. Every run costs credits. |
| `timeoutSeconds` | `900` | Per-worker wall clock. |
| `maxTurns` | `100` | `--max-turns` for each worker. |
| `guardrails` | `true` | Install the worktree deny-list overlay. |
| `extraArgs` | `[]` | Extra `cmd` arguments appended to every worker run. |
| `toolsEnable` | `[]` | Headless-withheld tools to re-enable, for example `todo_write`. |
| `command` | `cmd` on PATH | Override the binary. `CC_BRIDGE_COMMAND` is also honoured. |

Default routing stays on Go-and-above models so nothing is plan-gated out of the box: `deepseek/*` for
explorers, `moonshotai/Kimi-K2.7-Code` for implementers, `Qwen/Qwen3.8-Max` for reviewers.

## Verification

```sh
bun run smoke --fake          # full MCP round trip against a stub, no credits spent
bun run smoke                 # one real read-only explorer task (spends credits)
bun run smoke --fake --apply  # also exercise diff + apply
codex-commandcode-doctor      # health, Codex registration and worker records
```

## Exit codes

Command Code's exit codes drive the worker status: `0` completed, `8` completed but `truncated`,
`130` cancelled, and `3`/`4`/`5`/`6`/`7`/`9`/`10` failed with a specific message (not authenticated,
tool denied, rate limited, network, server error, no response, insufficient credits). A `result` frame
with `subtype: "error"` fails the run even when the process exits `0`.

## Known limits

1. **No model readback.** Command Code's headless `result` frame carries no model field, so the
   response reports the *requested* model and sets `modelVerified: false`. An invalid model id fails
   the run rather than silently downgrading.
2. **`--yolo` is broad.** Deny rules and the root/home circuit breaker hold, but Command Code does not
   gate absolute paths inside a shell command string, so a worker's shell can reach outside the
   worktree. The worktree is isolation, not a sandbox.
3. **Workers do not outlive the bridge.** Cancelling kills the process group; a bridge restart leaves
   no live worker, and `reconcile()` marks such records cancelled on startup.
4. **Trust records accumulate.** `--trust` is required for every throwaway worktree path.
5. **Credits.** Every worker run is billed. `parallelism` defaults to 2 for that reason.
