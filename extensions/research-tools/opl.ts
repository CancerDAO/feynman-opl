import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";

// feynman-opl is the CLIENT. The gated, attested oncology pipeline (20 named
// experts, Henry IRB auditor, ~42 mechanical safety gates, 46 biomedical
// integrators, provenance) lives in the opl-cancer Python engine and is invoked
// here via its CLI. We never re-implement that machinery in TypeScript, and we
// never substitute feynman's generic research subagents for OPL's named team.
// Resolved per-call so OPL_CANCER_BIN can be overridden at runtime.
function oplBin(): string {
	return process.env.OPL_CANCER_BIN?.trim() || "opl-cancer";
}

function installHint(bin: string): string {
	return (
		`OPL engine not found (tried \`${bin}\`). Install it with \`pip install opl-cancer\` ` +
		`(Python >= 3.11), or set OPL_CANCER_BIN to the executable. feynman-opl is the front-end; ` +
		`the gated oncology pipeline runs inside the opl-cancer engine.`
	);
}

interface OplResult {
	ok: boolean;
	// exit 2 is OPL's fail-closed convention: a deliberate gate / next-action, NOT
	// a retryable error. Surface it as-is; never "work around" a closed gate.
	blocked: boolean;
	engineMissing: boolean;
	exitCode: number | null;
	data: unknown;
	stderr: string;
}

const FAST_MS = 120_000;
const LONG_MS = 30 * 60_000;

function runOpl(args: string[], timeoutMs: number): Promise<OplResult> {
	const bin = oplBin();
	return new Promise((resolve) => {
		execFile(
			bin,
			args,
			// feynman-opl is bound to a single model, so it runs OPL single-model by
			// default (reviewer = executor; G13 cross-model peer review disabled).
			// Set OPL_ALLOW_SINGLE_MODEL=0 + two distinct provider keys to re-enable it.
			{
				maxBuffer: 64 * 1024 * 1024,
				timeout: timeoutMs,
				env: { ...process.env, OPL_ALLOW_SINGLE_MODEL: process.env.OPL_ALLOW_SINGLE_MODEL ?? "1" },
			},
			(error, stdout, stderr) => {
				const raw = (stdout ?? "").toString();
				const err = (stderr ?? "").toString();
				// Node sets error.code to a numeric exit code on non-zero exit, or a string
				// like "ENOENT" on spawn failure (the @types declaration is string-only).
				const code: number | string | undefined = error ? (error as unknown as { code?: number | string }).code : 0;
				if (code === "ENOENT") {
					resolve({ ok: false, blocked: false, engineMissing: true, exitCode: null, data: { error: installHint(bin) }, stderr: err });
					return;
				}
				const exitCode = typeof code === "number" ? code : error ? 1 : 0;
				let data: unknown = null;
				try {
					data = raw.trim() ? JSON.parse(raw) : null;
				} catch {
					data = null;
				}
				resolve({
					ok: exitCode === 0,
					blocked: exitCode === 2,
					engineMissing: false,
					exitCode,
					data: data ?? { raw_output: raw.slice(0, 8000) },
					stderr: err,
				});
			},
		);
	});
}

function present(label: string, r: OplResult) {
	const status = r.engineMissing
		? "engine-missing"
		: r.blocked
			? "blocked / fail-closed gate (exit 2) — do NOT bypass; address the gap it reports"
			: r.ok
				? "ok"
				: `error (exit ${r.exitCode})`;
	const body = JSON.stringify(r.data, null, 2);
	const trimmed = body.length > 16000 ? `${body.slice(0, 16000)}\n…(truncated)` : body;
	const tail = r.stderr && !r.ok ? `\nstderr:\n${r.stderr.slice(0, 2000)}` : "";
	return { content: [{ type: "text" as const, text: `[opl ${label}] status: ${status}\n${trimmed}${tail}` }], details: r };
}

export function registerOplTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "opl_preflight",
		label: "OPL Preflight",
		description:
			"Run the OPL engine self-check FIRST before any oncology run: verifies Python, LLM keys (MiniMax/Anthropic — distinct executor + reviewer required), biomedical integrators, and optional Docker. Wraps `opl-cancer preflight --json`.",
		parameters: Type.Object({
			allow_single_model: Type.Optional(
				Type.Boolean({ description: "Allow a single model (skips the distinct executor/reviewer requirement). Avoid for real runs." }),
			),
		}),
		async execute(_toolCallId, params) {
			const args = ["preflight", "--json"];
			if (params.allow_single_model) args.push("--allow-single-model");
			return present("preflight", await runOpl(args, FAST_MS));
		},
	});

	pi.registerTool({
		name: "opl_readiness",
		label: "OPL Readiness",
		description:
			"Run the OPL readiness gate over an ALREADY-ORGANIZED patient directory (profile.json + case_text.md present). Reports per-domain completeness and gaps. OPL is downstream of record intake — if the directory is not organized, say so instead of guessing. Wraps `opl-cancer readiness <patient_dir> --json`.",
		parameters: Type.Object({
			patient_dir: Type.String({ description: "Path to the organized patient directory." }),
		}),
		async execute(_toolCallId, params) {
			return present("readiness", await runOpl(["readiness", params.patient_dir, "--json"], FAST_MS));
		},
	});

	pi.registerTool({
		name: "opl_go",
		label: "OPL Go (orchestrator)",
		description:
			"The OPL orchestration brain. Given a patient directory + goal it returns the deterministic next action: which run-id, which experts PI 'Sid' planned, which wave to run next, and which artifacts are missing. Call this to decide the next step at EVERY stage instead of improvising. Wraps `opl-cancer go --patient <dir> --goal <goal> --json`.",
		parameters: Type.Object({
			patient_dir: Type.String({ description: "Path to the organized patient directory." }),
			goal: Type.Optional(Type.String({ description: "The patient's goal, verbatim (one plain sentence is fine)." })),
			run_id: Type.Optional(Type.String({ description: "Run id; omit to let OPL derive/mint one." })),
		}),
		async execute(_toolCallId, params) {
			const args = ["go", "--patient", params.patient_dir, "--json"];
			if (params.goal) args.push("--goal", params.goal);
			if (params.run_id) args.push("--run-id", params.run_id);
			return present("go", await runOpl(args, FAST_MS));
		},
	});

	pi.registerTool({
		name: "opl_plan",
		label: "OPL Plan (PI Sid)",
		description:
			"PI (Sid) plans the run — selects the named oncology expert team (a subset of OPL's 20 archetypes) and the waves to run. Wraps `opl-cancer plan --patient <dir> --goal <goal> --run-id <id> --json`.",
		parameters: Type.Object({
			patient_dir: Type.String(),
			goal: Type.String({ description: "The patient's goal, verbatim." }),
			run_id: Type.String({ description: "Run id (mint one via opl_go first if you don't have it)." }),
		}),
		async execute(_toolCallId, params) {
			return present(
				"plan",
				await runOpl(["plan", "--patient", params.patient_dir, "--goal", params.goal, "--run-id", params.run_id, "--json"], FAST_MS),
			);
		},
	});

	pi.registerTool({
		name: "opl_run",
		label: "OPL Run Wave (executor)",
		description:
			"Execute a wave with the OPL engine: dispatches the planned NAMED experts as real LLM calls, runs cross-model peer review, applies the mechanical safety gates, and writes provenance. This is the executor (needs a configured executor + distinct reviewer key). Never substitute feynman's generic researcher/reviewer/writer/verifier subagents for this — running generic agents instead of the planned team is the exact failure OPL gate G37 hard-blocks. Wraps `opl-cancer run --wave N --patient-dir <dir> --run-id <id> --json`.",
		parameters: Type.Object({
			wave: Type.Integer({ minimum: 1, maximum: 4, description: "Wave number 1-4." }),
			patient_dir: Type.String(),
			run_id: Type.String(),
			plan_path: Type.Optional(Type.String({ description: "Path to plan.json (defaults to the run's plan)." })),
			mode: Type.Optional(Type.String({ description: "Wave-3 compute mode: native, docker, or dry-run." })),
		}),
		async execute(_toolCallId, params) {
			const args = ["run", "--wave", String(params.wave), "--patient-dir", params.patient_dir, "--run-id", params.run_id, "--json"];
			if (params.plan_path) args.push("--plan-path", params.plan_path);
			if (params.mode) args.push("--mode", params.mode);
			return present(`run wave ${params.wave}`, await runOpl(args, LONG_MS));
		},
	});

	pi.registerTool({
		name: "opl_audit",
		label: "OPL Audit (gates)",
		description:
			"Run the delivery-integrity gate sweep (G34/G35/G37 + PMID citation gates). Fail-closed: returns blocked (exit 2) if the brief is not attestable. Report the gaps it lists; do not present an un-audited brief as final. Wraps `opl-cancer audit --patient <dir> --run-id <id> --json`.",
		parameters: Type.Object({ patient_dir: Type.String(), run_id: Type.String() }),
		async execute(_toolCallId, params) {
			return present("audit", await runOpl(["audit", "--patient", params.patient_dir, "--run-id", params.run_id, "--json"], FAST_MS));
		},
	});

	pi.registerTool({
		name: "opl_deliver",
		label: "OPL Deliver",
		description:
			"Assemble or finalize the patient research brief. Without --finalize it emits an honest scaffold; use --finalize only AFTER the waves and audit pass. Wraps `opl-cancer deliver --patient <dir> --run-id <id> [--finalize] --json`.",
		parameters: Type.Object({
			patient_dir: Type.String(),
			run_id: Type.String(),
			finalize: Type.Optional(Type.Boolean({ description: "Finalize delivery (audits already-filled briefs). Only after waves complete." })),
			dry_run: Type.Optional(Type.Boolean({ description: "Plan only; write nothing." })),
		}),
		async execute(_toolCallId, params) {
			const args = ["deliver", "--patient", params.patient_dir, "--run-id", params.run_id, "--json"];
			if (params.finalize) args.push("--finalize");
			if (params.dry_run) args.push("--dry-run");
			return present("deliver", await runOpl(args, FAST_MS));
		},
	});

	pi.registerTool({
		name: "opl_attest",
		label: "OPL Attest",
		description:
			"Attest a run's delivery integrity (G34/G35/G37 + citations). Exit 2 (blocked) if not attestable. Wraps `opl-cancer attest --patient <dir> --run-id <id> --json`.",
		parameters: Type.Object({ patient_dir: Type.String(), run_id: Type.String() }),
		async execute(_toolCallId, params) {
			return present("attest", await runOpl(["attest", "--patient", params.patient_dir, "--run-id", params.run_id, "--json"], FAST_MS));
		},
	});
}
