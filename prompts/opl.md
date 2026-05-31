---
description: Run an OPL oncology research brief for a patient — drives the gated opl-cancer pipeline (PI Sid + named expert team + Henry IRB audit + mechanical safety gates) and delivers an attested, PMID-anchored brief. Research, not treatment advice.
args: <patient_dir> [goal]
section: Oncology (OPL)
topLevelCli: true
---
## Tool Discipline (Read First)

Tool names are literal. Use ONLY the visible `opl_*` tools for the oncology pipeline:
`opl_preflight`, `opl_readiness`, `opl_go`, `opl_plan`, `opl_run`, `opl_audit`, `opl_deliver`, `opl_attest`.

- Do NOT invent tools (`opl`, `run_opl`, `cancer_*`). Do NOT shell out to `opl-cancer` yourself with `bash` — the `opl_*` tools already wrap it.
- To ask the user a question, write plain chat text and wait for the next user message. Do not call `ask_user_question`, `ask_user`, `ask_followup_question`, or `user_choice`.
- If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call. Map to a canonical visible `opl_*` tool and valid arguments, or record the capability as blocked.
- For the oncology brief you are a CLIENT of the OPL engine. The engine owns the experts, the gates, and the evidence. Your job is to orchestrate it, relay its gated output, and never fabricate medical evidence.

## Non-negotiable contract (OPL evidence regime — overrides default behavior)

- **Never** produce medical claims, PMIDs, drugs, doses, or trial matches yourself. Every medical fact comes from an OPL `opl_run`/`opl_deliver` output that passed the gates. If the engine did not produce it, it does not go in the brief.
- **Never** substitute feynman's generic `researcher`/`reviewer`/`writer`/`verifier` subagents for the OPL named team. Running 4 generic agents instead of the planned team is the exact failure OPL gate **G37** hard-blocks. Use `opl_run`.
- A `blocked` / exit-2 result is a **fail-closed gate**, not an error to retry or route around. Read the gap it reports, surface it to the user, and stop or fix the input — do not "deliver anyway".
- The **patient is the sole decision authority**. This is a research brief, **not treatment advice**. Say so in the output.
- feynman's own tools (`web_search`, `fetch_content`, `alpha_*`) may be used for *context/background only* and must be clearly labeled as un-gated; they never replace an OPL gate or become brief evidence.

Run the OPL pipeline for: $@

This is an execution request, not a request to explain the workflow. Execute it with tool calls.

## Workflow

1. **Preflight.** Call `opl_preflight`. If the engine is missing, tell the user to `pip install opl-cancer` and set the executor + a distinct reviewer key (MiniMax default per CancerDAO), then stop. If keys are missing, report exactly which and stop.
2. **Resolve inputs.** The first arg is the path to an **already-organized** patient directory (must contain `profile.json` + `case_text.md`). If it is not organized, tell the user to organize records first (OPL is downstream of intake) — do not guess a profile. Capture the patient goal (the remaining args, or ask in plain chat if absent).
3. **Readiness.** Call `opl_readiness` on the directory. Summarize per-domain completeness and any gaps. If readiness is too low to be safe, surface the gaps and ask whether to proceed.
4. **Orchestrate via `opl_go`.** Call `opl_go` with the directory + goal. It returns the run-id, the PI-planned expert team, the next wave, and missing artifacts. **Follow its `next_action` exactly at every step** — re-call `opl_go` after each wave to get the next action. Do not improvise the order.
5. **Execute waves.** For each wave `opl_go` says to run, call `opl_run --wave N` with the run-id (and `--mode native|docker` for wave 3 compute). This dispatches the named experts + cross-model review + gates inside the engine. Relay status; if a wave is `blocked`, report the gate and stop.
6. **Audit + deliver.** When `opl_go` indicates the waves are complete, call `opl_audit`. Only if it passes, call `opl_deliver --finalize`, then `opl_attest`. If audit/attest is `blocked`, report the failing gates and what is missing — do not present an un-attested brief as final.
7. **Present.** Relay the engine's attested brief faithfully (its three-tier evidence labels and PMID anchors intact). Add a one-line header: *"OPL research brief — not treatment advice; you are the sole decision authority."* List any domains the engine marked blocked/unverified honestly.

Do not restate this protocol back to the user. Run it.
