import { describe, expect, it } from "vitest";
import { occupiesSeat, type PlayerRow } from "../repositories/playersRepo.js";

function player(overrides: Partial<PlayerRow>): PlayerRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    roomId: "00000000-0000-0000-0000-000000000001",
    displayName: "P",
    sessionToken: "t",
    ready: false,
    connected: false,
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
    ...overrides,
  } as PlayerRow;
}

const NOW = 1_000_000_000_000;

describe("occupiesSeat (ghost-join reclaim predicate)", () => {
  it("a connected player always occupies a seat, however old", () => {
    expect(occupiesSeat(player({ connected: true, lastSeenAt: new Date(NOW - 999_999) }), NOW)).toBe(true);
  });

  it("a just-joined player occupies a seat during the handshake grace window", () => {
    expect(occupiesSeat(player({ connected: false, lastSeenAt: new Date(NOW - 1_000) }), NOW)).toBe(true);
  });

  it("a never-connected player past the grace window is reclaimable", () => {
    expect(occupiesSeat(player({ connected: false, lastSeenAt: new Date(NOW - 61_000) }), NOW)).toBe(false);
  });

  it("boundary: exactly at the grace window is reclaimable", () => {
    expect(occupiesSeat(player({ connected: false, lastSeenAt: new Date(NOW - 60_000) }), NOW)).toBe(false);
  });
});
