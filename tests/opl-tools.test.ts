import test from "node:test";
import assert from "node:assert/strict";

import { registerOplTools } from "../extensions/research-tools/opl.js";

type Tool = { name: string; description: string; execute: (id: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; details: { engineMissing: boolean; ok: boolean; blocked: boolean } }> };

function collectTools(): Record<string, Tool> {
	const tools: Record<string, Tool> = {};
	registerOplTools({ registerTool: (t: Tool) => { tools[t.name] = t; } } as never);
	return tools;
}

test("OPL client registers the full tool suite", () => {
	const tools = collectTools();
	for (const name of ["opl_preflight", "opl_readiness", "opl_go", "opl_plan", "opl_run", "opl_audit", "opl_deliver", "opl_attest"]) {
		assert.ok(tools[name], `missing tool ${name}`);
		assert.equal(typeof tools[name].execute, "function");
	}
});

test("OPL tools report engine-missing gracefully when opl-cancer is absent (no throw)", async () => {
	const previous = process.env.OPL_CANCER_BIN;
	process.env.OPL_CANCER_BIN = "opl-cancer-definitely-not-installed-xyz";
	try {
		const tools = collectTools();
		const preflight = await tools.opl_preflight.execute("t", {});
		assert.equal(preflight.details.engineMissing, true);
		assert.equal(preflight.details.ok, false);
		assert.match(preflight.content[0].text, /engine-missing/);

		// the executor path must also degrade gracefully, not crash
		const run = await tools.opl_run.execute("t", { wave: 1, patient_dir: "/tmp/x", run_id: "r1" });
		assert.equal(run.details.engineMissing, true);
	} finally {
		if (previous === undefined) delete process.env.OPL_CANCER_BIN;
		else process.env.OPL_CANCER_BIN = previous;
	}
});
