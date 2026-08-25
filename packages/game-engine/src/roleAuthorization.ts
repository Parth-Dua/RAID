import type { Role, ScenarioDefinition } from "@raid/shared";

export function isToolAuthorizedForRole(scenario: ScenarioDefinition, toolId: string, role: Role): boolean {
  const tool = scenario.tools.find((t) => t.id === toolId);
  if (!tool) return false;
  // Incident Commander has no simulated tools of their own — they work from the shared board.
  return tool.role === role;
}

export function toolsForRole(scenario: ScenarioDefinition, role: Role) {
  return scenario.tools.filter((t) => t.role === role);
}
