/**
 * vote_processor  –  vm-core
 *
 * Kafka consumer group: "vote-processor"
 *
 * Inputs:
 *   topic  raw_votes        { user_id, vote, region, ts }
 *
 * Outputs:
 *   topic  processed_votes  { vote_id, user_id, vote, region, ts, processed_at }
 *   topic  flagged_votes    { vote_id, user_id, reason, ts }
 *   exchange global_results_fanout  { totals: Record<candidate,count>, snapshot_at }
 *
 * Stateful behaviour (in-process KTable):
 *   – Tracks every user_id that has already cast a vote (deduplication).
 *   – Duplicate votes are produced to flagged_votes and NOT forwarded.
 *   – On start-up, replays raw_votes from offset 0 to rebuild state before
 *     joining the live consumer group.
 */

import { randomUUID } from "node:crypto";
import {
  AuthClient,
  connectRabbitMqWithOAuth,
  createKafkaWithOAuth,
  loadTlsConfigFromEnv
} from "@zt/common";
import type { Channel } from "amqplib";

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

type ProcessedVote = {
  vote_id: string;
  user_id: string;
  vote: string;
  region: string;
  ts: number;
  processed_at: number;
};

type FlaggedVote = {
  vote_id: string;
  user_id: string;
  reason: string;
  ts: number;
};

const GLOBAL_EXCHANGE = "global_results_fanout";

async function main() {
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
    clientId: "vote-processor",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  const producer = kafka.producer();
  await producer.connect();

  // ── RabbitMQ fanout for global dashboard ───────────────────────────────────
  const rabbitHost = mustGetEnv("RABBIT_HOST");
  const rabbitPort = Number(process.env.RABBIT_PORT ?? "5672");
  const rabbitTls = loadTlsConfigFromEnv("RABBIT_TLS");

  const amqpConn = await connectRabbitMqWithOAuth({
    host: rabbitHost,
    port: rabbitPort,
    vhost: process.env.RABBIT_VHOST ?? "/",
    getToken: () => auth.getAccessToken(),
    tls: {
      ca: rabbitTls.ca,
      rejectUnauthorized: rabbitTls.rejectUnauthorized
    }
  });
  const fanoutChannel: Channel = await amqpConn.createChannel();
  await fanoutChannel.assertExchange(GLOBAL_EXCHANGE, "fanout", { durable: true });

  // Running global totals — broadcast to the fanout exchange after each vote.
  const globalTotals = new Map<string, number>();
  let lastPublishAt = 0;
  const PUBLISH_DEBOUNCE_MS = Number(process.env.FANOUT_DEBOUNCE_MS ?? "2000");

  function publishGlobalSnapshot(): void {
    const now = Date.now();
    if (now - lastPublishAt < PUBLISH_DEBOUNCE_MS) return;
    lastPublishAt = now;
    fanoutChannel.publish(
      GLOBAL_EXCHANGE,
      "", // fanout ignores routing key
      Buffer.from(
        JSON.stringify({ totals: Object.fromEntries(globalTotals), snapshot_at: now })
      ),
      { contentType: "application/json", persistent: true }
    );
  }

  // ── Phase 1: replay raw_votes to rebuild deduplication KTable ─────────────
  const seenVoters = new Map<string, string>(); // user_id → vote_id

  const replayConsumer = kafka.consumer({
    groupId: `vote-processor-replay-${randomUUID()}`
  });
  await replayConsumer.connect();
  await replayConsumer.subscribe({ topic: "raw_votes", fromBeginning: true });

  await new Promise<void>((resolve) => {
    let settled = false;

    replayConsumer
      .run({
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
          for (const message of batch.messages) {
            if (!isRunning() || isStale()) break;
            if (message.value) {
              try {
                const raw = JSON.parse(message.value.toString("utf8")) as RawVote;
                if (raw.user_id && !seenVoters.has(raw.user_id)) {
                  seenVoters.set(raw.user_id, randomUUID());
                  // Also rebuild global totals from history
                  if (raw.vote) {
                    globalTotals.set(raw.vote, (globalTotals.get(raw.vote) ?? 0) + 1);
                  }
                }
              } catch {
                // malformed — skip
              }
            }
            resolveOffset(message.offset);
            await heartbeat();
          }

          if (!settled && batch.offsetLagLow === BigInt(0)) {
            settled = true;
            resolve();
          }
        }
      })
      .catch(() => {
        if (!settled) { settled = true; resolve(); }
      });

    // Fallback: resolve if topic is empty
    setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 5000);
  });

  await replayConsumer.disconnect();

  process.stderr.write(
    `[vote-processor] KTable rebuilt — ${seenVoters.size} known voters, ` +
    `${globalTotals.size} candidates tracked\n`
  );

  // ── Phase 2: live processing ───────────────────────────────────────────────
  const consumer = kafka.consumer({ groupId: "vote-processor" });
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

      if (!raw.user_id || !raw.vote) return;

      if (seenVoters.has(raw.user_id)) {
        const flagged: FlaggedVote = {
          vote_id: seenVoters.get(raw.user_id)!,
          user_id: raw.user_id,
          reason: "duplicate_vote",
          ts: raw.ts
        };
        await producer.send({
          topic: "flagged_votes",
          messages: [
            {
              key: raw.user_id,
              value: JSON.stringify(flagged),
              headers: { "content-type": Buffer.from("application/json") }
            }
          ]
        });
        return;
      }

      const voteId = randomUUID();
      seenVoters.set(raw.user_id, voteId);

      const processed: ProcessedVote = {
        vote_id: voteId,
        user_id: raw.user_id,
        vote: raw.vote,
        region: raw.region ?? "unknown",
        ts: raw.ts,
        processed_at: Date.now()
      };

      await producer.send({
        topic: "processed_votes",
        messages: [
          {
            key: raw.user_id,
            value: JSON.stringify(processed),
            headers: { "content-type": Buffer.from("application/json") }
          }
        ]
      });

      // Update global totals and broadcast to dashboards.
      globalTotals.set(raw.vote, (globalTotals.get(raw.vote) ?? 0) + 1);
      publishGlobalSnapshot();
    }
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
