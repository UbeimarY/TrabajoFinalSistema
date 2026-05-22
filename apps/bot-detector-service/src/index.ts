/**
 * bot_detector_service  –  vm-core
 *
 * Kafka consumer group: "bot-detector"
 *
 * Input:
 *   topic  raw_votes   { user_id, vote, region, ts }
 *
 * Output:
 *   topic  flagged_votes  { vote_id, user_id, reason, ts }
 *
 * Detection strategy (stateless window, in-process):
 *   – Maintains a sliding 60-second count per region.
 *   – If a region emits more than RATE_LIMIT_PER_REGION_PER_MINUTE votes
 *     in a 60 s window, each excess vote is flagged as "rate_limit_exceeded".
 *   – Also tracks per-user inter-arrival time: if two votes from the same
 *     user_id arrive within MIN_INTER_ARRIVAL_MS, the second is flagged as
 *     "bot_rapid_fire".
 *
 * Configuration env vars:
 *   RATE_LIMIT_PER_REGION_PER_MINUTE  (default 100)
 *   MIN_INTER_ARRIVAL_MS              (default 500)
 */

import { randomUUID } from "node:crypto";
import {
  AuthClient,
  createKafkaWithOAuth,
  loadTlsConfigFromEnv
} from "@zt/common";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

type RawVote = {
  user_id: string;
  vote: string;
  region: string;
  ts: number;
};

type FlaggedVote = {
  vote_id: string;
  user_id: string;
  reason: string;
  ts: number;
};

const WINDOW_MS = 60_000;

async function main() {
  const rateLimit = Number(
    process.env.RATE_LIMIT_PER_REGION_PER_MINUTE ?? "100"
  );
  const minInterArrivalMs = Number(
    process.env.MIN_INTER_ARRIVAL_MS ?? "500"
  );

  const authTls = loadTlsConfigFromEnv("AUTH_TLS");
  const auth = new AuthClient({
    authBaseUrl: mustGetEnv("AUTH_BASE_URL"),
    clientId: mustGetEnv("CLIENT_ID"),
    clientSecret: mustGetEnv("CLIENT_SECRET"),
    ca: authTls.ca
  });

  const kafkaBrokers = mustGetEnv("KAFKA_BROKERS").split(",").filter(Boolean);
  const kafkaTls = loadTlsConfigFromEnv("KAFKA_TLS");

  const kafka = createKafkaWithOAuth({
    clientId: "bot-detector-service",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  const producer = kafka.producer();
  await producer.connect();

  // region → ring-buffer of timestamps within the current window
  const regionWindows = new Map<string, number[]>();
  // user_id → timestamp of last seen vote
  const lastSeenUser = new Map<string, number>();

  function purgeOldEntries(timestamps: number[], now: number): number[] {
    return timestamps.filter((t) => now - t < WINDOW_MS);
  }

  const consumer = kafka.consumer({ groupId: "bot-detector" });
  await consumer.connect();
  await consumer.subscribe({ topic: "raw_votes", fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let raw: RawVote;
      try {
        raw = JSON.parse(message.value.toString("utf8")) as RawVote;
      } catch {
        return;
      }

      if (!raw.user_id) return;

      const now = Date.now();
      const flaggedMessages: FlaggedVote[] = [];

      // ── Rapid-fire check ───────────────────────────────────────────────────
      const lastSeen = lastSeenUser.get(raw.user_id);
      if (lastSeen !== undefined && now - lastSeen < minInterArrivalMs) {
        flaggedMessages.push({
          vote_id: randomUUID(),
          user_id: raw.user_id,
          reason: "bot_rapid_fire",
          ts: raw.ts
        });
      }
      lastSeenUser.set(raw.user_id, now);

      // ── Regional rate-limit check ──────────────────────────────────────────
      const region = raw.region ?? "unknown";
      let window = purgeOldEntries(regionWindows.get(region) ?? [], now);
      window.push(now);
      regionWindows.set(region, window);

      if (window.length > rateLimit) {
        flaggedMessages.push({
          vote_id: randomUUID(),
          user_id: raw.user_id,
          reason: "rate_limit_exceeded",
          ts: raw.ts
        });
      }

      if (flaggedMessages.length === 0) return;

      await producer.send({
        topic: "flagged_votes",
        messages: flaggedMessages.map((f) => ({
          key: f.user_id,
          value: JSON.stringify(f),
          headers: { "content-type": Buffer.from("application/json") }
        }))
      });
    }
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
