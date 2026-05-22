/**
 * regional_rollup_service  –  vm-core
 *
 * Kafka consumer group: "regional-rollup"
 *
 * Input:
 *   topic  processed_votes  { vote_id, user_id, vote, region, ts, processed_at }
 *
 * Stateful KTable (in-process):
 *   region → Map<candidate, count>
 *
 * Output (RabbitMQ Fanout):
 *   exchange  regional_results_fanout
 *   payload   { region, totals: { [candidate]: count }, snapshot_at }
 *
 * Publishes a snapshot every PUBLISH_INTERVAL_MS (default 5 000 ms)
 * for each region that received at least one new vote since the last snapshot.
 */

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

type ProcessedVote = {
  vote_id: string;
  user_id: string;
  vote: string;
  region: string;
  ts: number;
};

type RegionalSnapshot = {
  region: string;
  totals: Record<string, number>;
  snapshot_at: number;
};

const EXCHANGE = "regional_results_fanout";

async function main() {
  const publishIntervalMs = Number(
    process.env.PUBLISH_INTERVAL_MS ?? "5000"
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
    clientId: "regional-rollup-service",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

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

  const channel: Channel = await amqpConn.createChannel();
  // Declare the fanout exchange — idempotent, safe to call on every startup.
  await channel.assertExchange(EXCHANGE, "fanout", { durable: true });

  // KTable: region → candidate → count
  const regionalTotals = new Map<string, Map<string, number>>();
  // Regions that have received new votes since the last publish cycle
  const dirtyRegions = new Set<string>();

  // ── Periodic publisher ─────────────────────────────────────────────────────
  const publishTimer = setInterval(async () => {
    if (dirtyRegions.size === 0) return;

    const snapshots: RegionalSnapshot[] = [];
    for (const region of dirtyRegions) {
      const totals = regionalTotals.get(region);
      if (!totals) continue;
      snapshots.push({
        region,
        totals: Object.fromEntries(totals),
        snapshot_at: Date.now()
      });
    }
    dirtyRegions.clear();

    for (const snapshot of snapshots) {
      channel.publish(
        EXCHANGE,
        "", // fanout ignores routing key
        Buffer.from(JSON.stringify(snapshot)),
        { contentType: "application/json", persistent: true }
      );
    }
  }, publishIntervalMs);

  publishTimer.unref(); // don't keep process alive by timer alone

  // ── Kafka consumer ─────────────────────────────────────────────────────────
  const consumer = kafka.consumer({ groupId: "regional-rollup" });
  await consumer.connect();
  await consumer.subscribe({ topic: "processed_votes", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      let vote: ProcessedVote;
      try {
        vote = JSON.parse(message.value.toString("utf8")) as ProcessedVote;
      } catch {
        return;
      }

      if (!vote.vote || !vote.region) return;

      const region = vote.region;
      if (!regionalTotals.has(region)) {
        regionalTotals.set(region, new Map());
      }
      const totals = regionalTotals.get(region)!;
      totals.set(vote.vote, (totals.get(vote.vote) ?? 0) + 1);
      dirtyRegions.add(region);
    }
  });
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
