import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * See docs/DATABASE.md for the ER diagram and the reasoning behind every
 * table and the (deliberately few) JSONB columns.
 */

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 8 }).notNull().unique(),
  phase: varchar("phase", { length: 20 }).notNull().default("LOBBY"),
  hostPlayerId: uuid("host_player_id"),
  currentGameId: uuid("current_game_id"),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 40 }).notNull(),
  sessionToken: varchar("session_token", { length: 64 }).notNull().unique(),
  ready: boolean("ready").notNull().default(false),
  connected: boolean("connected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  scenarioId: varchar("scenario_id", { length: 60 }).notNull(),
  difficulty: varchar("difficulty", { length: 10 }).notNull().default("NORMAL"),
  durationSeconds: integer("duration_seconds").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gamePlayers = pgTable(
  "game_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 30 }).notNull(),
  },
  (t) => [uniqueIndex("game_players_game_player_uq").on(t.gameId, t.playerId)],
);

export const gameEvidence = pgTable(
  "game_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    evidenceId: varchar("evidence_id", { length: 60 }).notNull(),
    unlockedAtSeconds: integer("unlocked_at_seconds").notNull(),
    unlockedByPlayerId: uuid("unlocked_by_player_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("game_evidence_game_evidence_uq").on(t.gameId, t.evidenceId)],
);

export const toolActions = pgTable("tool_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  toolId: varchar("tool_id", { length: 60 }).notNull(),
  executedAtSeconds: integer("executed_at_seconds").notNull(),
  output: text("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("OPEN"),
    aiRationale: text("ai_rationale"),
    version: integer("version").notNull().default(0),
    clientMsgId: uuid("client_msg_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hypotheses_dedup_uq").on(t.gameId, t.clientMsgId)],
);

export const hypothesisReactions = pgTable(
  "hypothesis_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hypothesisId: uuid("hypothesis_id")
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 10 }).notNull(), // 'support' | 'challenge'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hypothesis_reactions_uq").on(t.hypothesisId, t.playerId, t.kind)],
);

export const hypothesisEvidence = pgTable(
  "hypothesis_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hypothesisId: uuid("hypothesis_id")
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    evidenceId: varchar("evidence_id", { length: 60 }).notNull(),
    attachedBy: uuid("attached_by")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hypothesis_evidence_uq").on(t.hypothesisId, t.evidenceId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    authorId: uuid("author_id"),
    authorName: varchar("author_name", { length: 40 }).notNull(),
    text: text("text").notNull(),
    // "player" | "system" | "ai_intervention" (V0.4) - widened from 10 to fit "ai_intervention".
    kind: varchar("kind", { length: 20 }).notNull().default("player"),
    clientMsgId: uuid("client_msg_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_messages_dedup_uq").on(t.gameId, t.clientMsgId)],
);

export const knownFacts = pgTable("known_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  category: varchar("category", { length: 10 }).notNull().default("fact"), // 'fact' | 'question'
  sourceEvidenceId: varchar("source_evidence_id", { length: 60 }),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * V0.4 adaptive Game Master intervention history — one row per intervention actually delivered
 * (proposals the AI declined, or that failed backend validation/budget checks, are never
 * persisted here; they only ever exist as an in-memory AIInvocationMeta for logging). Durable
 * history backs the per-game intervention budget (max count + cooldown, see gameMasterService.ts)
 * and is queryable independently of chat_messages, which mixes interventions in with player/system
 * chat for the UI.
 */
export const gameInterventions = pgTable("game_interventions", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  classification: varchar("classification", { length: 30 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(),
  message: text("message").notNull(),
  targetRole: varchar("target_role", { length: 30 }),
  confidence: integer("confidence_pct").notNull(), // 0-100, stored as an int (confidence * 100)
  elapsedSeconds: integer("elapsed_seconds").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only event log. `seq` gives a monotonic total order independent of
 * timestamp clock resolution — used to reconstruct the debrief timeline and
 * for audit/replay. This is NOT full event sourcing: current state (rooms,
 * players, games, hypotheses, ...) lives in its own tables and is written
 * directly by services; the log is a secondary, append-only record of what
 * happened, not the source current state is rehydrated from. See
 * docs/DATABASE.md "Event log vs. event sourcing".
 */
export const gameEvents = pgTable("game_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: uuid("id").notNull().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  gameId: uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 40 }).notNull(),
  payload: jsonb("payload").notNull().default({}),
  actorPlayerId: uuid("actor_player_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const finalSubmissions = pgTable("final_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" })
    .unique(),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  rootCause: text("root_cause").notNull(),
  supportingEvidenceIds: jsonb("supporting_evidence_ids").notNull().default(sql`'[]'::jsonb`),
  remediation: text("remediation").notNull(),
  clientMsgId: uuid("client_msg_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameResults = pgTable("game_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" })
    .unique(),
  rootCauseAccuracy: integer("root_cause_accuracy").notNull(),
  evidenceQuality: integer("evidence_quality").notNull(),
  remediationQuality: integer("remediation_quality").notNull(),
  efficiency: integer("efficiency").notNull(),
  collaboration: integer("collaboration").notNull(),
  total: integer("total").notNull(),
  debrief: jsonb("debrief").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- relations (for query ergonomics only, no behavior) ----

export const roomsRelations = relations(rooms, ({ many }) => ({
  players: many(players),
  games: many(games),
}));

export const playersRelations = relations(players, ({ one }) => ({
  room: one(rooms, { fields: [players.roomId], references: [rooms.id] }),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
  room: one(rooms, { fields: [games.roomId], references: [rooms.id] }),
  gamePlayers: many(gamePlayers),
  hypotheses: many(hypotheses),
  chatMessages: many(chatMessages),
}));
