/** Product-sized payload probe: same generator and proposal build used by D11 UI. */
import { createCase001 } from "../model/logistics/case001.ts";
import { runScenario } from "../model/logistics/engine.ts";
import { simulateOperations } from "../model/logistics/execution.ts";
import { buildCase001ProposalData } from "../model/logistics/proposal.ts";
import { buildD11BrowserProposal, D11_MAX_BYTES } from "../src/components/tools/d11-transfer.ts";

const workloads = [
  { days: 3, orders: 40 }, { days: 5, orders: 380 },
];
for (const workload of workloads) {
  const state = { ...workload, demand: 100, fuel: 100, breakdown: 0,
    trafficPercent: 100, dockDelayMinutes: 0, extraServiceMinutes: 0,
    pickingWorkers: 20, maxRunsPerVehicle: 2, peakTravelPercent: 120,
    maxStopsPerTrip: 12, stockCoveragePercent: 100, importedModel: null };
  const start = Date.now();
  const model = createCase001({ days: state.days, dailyOrders: state.orders,
    demandMultiplier: 1, fuelMultiplier: 1, pickingWorkers: state.pickingWorkers,
    maxRunsPerVehicle: state.maxRunsPerVehicle, peakTravelPercent: state.peakTravelPercent,
    maxStopsPerTrip: state.maxStopsPerTrip, stockCoveragePercent: state.stockCoveragePercent });
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  const settings = { trafficPercent: 100, dockDelayMinutes: 0,
    extraServiceMinutes: 0, latePenaltyRub: 2500, rejectOutOfWindow: true };
  const operationBefore = simulateOperations(model, before, settings);
  const operationAfter = simulateOperations(model, after, settings);
  const data = buildCase001ProposalData({ state, model, before, after, operationBefore, operationAfter });
  const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
  let transferBytes = 0, transferError = "none";
  try {
    const proposal = buildD11BrowserProposal({ toolId: "delivery-network-planner",
      toolTitle: "CASE-001", markdown: "# CASE-001", data }, "2026-11-13T00:00:00.000Z");
    transferBytes = new TextEncoder().encode(JSON.stringify(proposal)).length;
  } catch (error) {
    transferError = error instanceof Error ? error.message : String(error);
  }
  console.log("D11_PAYLOAD_PROBE", JSON.stringify({
    workload, bytes, limit: D11_MAX_BYTES, transferBytes, transferError,
    timeMs: Date.now() - start, planned: after.delivered,
    replanned: data.replanning?.revisedScheduled,
    rejected: data.replanning?.actualRefused,
    audit: data.replanning?.audit,
  }));
  if (before.audit.length || after.audit.length || operationBefore.audit.length ||
      operationAfter.audit.length || data.replanning?.audit.length) process.exitCode = 1;
}
