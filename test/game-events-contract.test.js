import test from "node:test";
import assert from "node:assert/strict";
import { gameEventSchema, NORMALIZED_GAME_EVENT_TYPES } from "../dist/routes/game-events.js";

const baseEvent = {
  game: "atlas",
  eventId: "provider-event-1",
  eventType: "player.joined",
  occurredAt: "2026-11-12T16:00:00.000Z",
  payload: { providerPlayerId: "player-1" }
};

 test("accepts every normalized Core event type", () => {
  assert.equal(NORMALIZED_GAME_EVENT_TYPES.length, 23);
  for (const eventType of NORMALIZED_GAME_EVENT_TYPES) {
    const parsed = gameEventSchema.safeParse({ ...baseEvent, eventType });
    assert.equal(parsed.success, true, `expected ${eventType} to be accepted`);
  }
});

test("accepts scoped cross-grid events and optional correlation IDs", () => {
  const parsed = gameEventSchema.safeParse({
    ...baseEvent,
    scope: {
      clusterId: "2c1c0b7e-1c42-4d9f-bd1c-1d45a90b3a10",
      gridId: "A1",
      serverId: "d4c9dbf7-6d89-4c79-9a6b-4f3f5f3a8b22"
    },
    correlationId: "transfer-42"
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.scope.gridId, "A1");
  assert.equal(parsed.data.correlationId, "transfer-42");
});

test("keeps legacy event envelopes valid without scope or correlation metadata", () => {
  const parsed = gameEventSchema.safeParse(baseEvent);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.scope, undefined);
  assert.equal(parsed.data.correlationId, undefined);
});

test("rejects unknown event types and malformed scope metadata", () => {
  assert.equal(gameEventSchema.safeParse({ ...baseEvent, eventType: "ship.teleported" }).success, false);
  assert.equal(gameEventSchema.safeParse({
    ...baseEvent,
    scope: { clusterId: "not-a-uuid", gridId: "A1", serverId: "also-not-a-uuid" }
  }).success, false);
  assert.equal(gameEventSchema.safeParse({
    ...baseEvent,
    scope: {
      clusterId: "2c1c0b7e-1c42-4d9f-bd1c-1d45a90b3a10",
      gridId: " ",
      serverId: "d4c9dbf7-6d89-4c79-9a6b-4f3f5f3a8b22"
    }
  }).success, false);
  assert.equal(gameEventSchema.safeParse({ ...baseEvent, correlationId: " " }).success, false);
});
