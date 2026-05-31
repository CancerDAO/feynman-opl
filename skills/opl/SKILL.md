---
name: opl
description: Run an OPL oncology research brief for a cancer patient from their organized records. Use when the user asks for next-line options, NGS/genomic interpretation, clinical-trial matching, or a tumor-board-style analysis of a patient's case. Drives the gated opl-cancer engine (PI Sid + named expert team + Henry IRB audit + mechanical safety gates) and delivers an attested, PMID-anchored brief. Research, not treatment advice.
---

# OPL (oncology research brief)

Run the `/opl` workflow. The slash command expands the full workflow instructions in the active session; do not try to read a relative prompt-template path from the installed skill directory.

feynman-opl is the CLIENT; the gated pipeline runs in the `opl-cancer` Python engine (install: `pip install opl-cancer`, Python >= 3.11) and is reached through the `opl_*` tools.

Contract: medical evidence comes only from gated OPL outputs (never fabricated, never from the generic research subagents — that is OPL gate G37's blocked failure mode). A `blocked`/exit-2 result is a fail-closed gate; report the gap, do not bypass. The patient is the sole decision authority; output is a research brief, not treatment advice.

Tools: `opl_preflight`, `opl_readiness`, `opl_go` (orchestrator), `opl_plan`, `opl_run`, `opl_audit`, `opl_deliver`, `opl_attest`.
