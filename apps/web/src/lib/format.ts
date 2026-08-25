export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

export function roleLabel(role: string | null): string {
  switch (role) {
    case "backend_engineer":
      return "Backend Engineer";
    case "database_engineer":
      return "Database Engineer";
    case "sre":
      return "SRE / Infra";
    case "incident_commander":
      return "Incident Commander";
    default:
      return "Your role";
  }
}
