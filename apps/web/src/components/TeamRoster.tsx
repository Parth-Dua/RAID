import { useGame } from "../state/GameProvider.js";

const ROLE_LABEL: Record<string, string> = {
  backend_engineer: "Backend",
  database_engineer: "Database",
  sre: "SRE / Infra",
  incident_commander: "Incident Commander",
};

/**
 * Roles are visible to everyone once the game starts (RoomSnapshot always carries every player's
 * role - see docs/GAME_DESIGN.md "why roles, not just evidence, are shared"). This is deliberate:
 * knowing WHO to ask is realistic incident-response coordination and costs nothing in terms of the
 * asymmetric-EVIDENCE design, since no evidence content is exposed here.
 */
export function TeamRoster() {
  const { roomSnapshot, myPlayerId } = useGame();
  if (!roomSnapshot) return null;

  return (
    <div className="flex flex-col gap-1">
      {roomSnapshot.players.map((p) => (
        <div key={p.id} className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? "bg-ok" : "bg-ink-500"}`} />
            <span className={p.id === myPlayerId ? "text-accent font-medium" : "text-ink-200"}>{p.displayName}</span>
          </span>
          <span className="text-ink-400">{p.role ? ROLE_LABEL[p.role] ?? p.role : "—"}</span>
        </div>
      ))}
    </div>
  );
}
