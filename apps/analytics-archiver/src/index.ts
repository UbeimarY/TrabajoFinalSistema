/**
 * analytics_archiver  –  vm-core
 *
 * Kafka consumer group: "analytics-archiver"
 *
 * Inputs:
 *   topic  processed_votes
 *   topic  flagged_votes
 *
 * Behaviour:
 *   Appends every record as a newline-delimited JSON entry to rotating
 *   daily log files under ARCHIVE_DIR (default /var/lib/zt-archive).
 *
 *   File naming:
 *     processed_votes-YYYY-MM-DD.ndjson
 *     flagged_votes-YYYY-MM-DD.ndjson
 *
 *   In a real deployment these files would be shipped to S3/GCS.
 *   For this project they serve as the durable audit trail required
 *   by the Zero Trust spec ("analytics_archiver persists histórico").
 *
 * No output topics — this is a pure sink.
 */

import fs from "node:fs";
import path from "node:path";
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

function utcDateString(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
}

function getArchiveStream(
  dir: string,
  topic: string,
  date: string
): fs.WriteStream {
  const filePath = path.join(dir, `${topic}-${date}.ndjson`);
  return fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
}

async function main() {
  const archiveDir = process.env.ARCHIVE_DIR ?? "/var/lib/zt-archive";
  fs.mkdirSync(archiveDir, { recursive: true });

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
    clientId: "analytics-archiver",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  // Cache open streams by "topic-date" to avoid opening a new fd per message.
  const streams = new Map<string, fs.WriteStream>();
  let currentDate = utcDateString();

  function streamFor(topic: string): fs.WriteStream {
    const today = utcDateString();

    // Rotate at UTC midnight: close all streams and clear cache.
    if (today !== currentDate) {
      for (const s of streams.values()) s.end();
      streams.clear();
      currentDate = today;
    }

    const key = `${topic}-${today}`;
    if (!streams.has(key)) {
      streams.set(key, getArchiveStream(archiveDir, topic, today));
    }
    return streams.get(key)!;
  }

  function archive(topic: string, value: Buffer): void {
    const line = value.toString("utf8").replace(/\n/g, " ") + "\n";
    streamFor(topic).write(line);
  }

  const consumer = kafka.consumer({ groupId: "analytics-archiver" });
  await consumer.connect();
  await consumer.subscribe({ topic: "processed_votes", fromBeginning: true });
  await consumer.subscribe({ topic: "flagged_votes", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      archive(topic, message.value);
    }
  });

  // Graceful shutdown: flush streams.
  const shutdown = () => {
    consumer.disconnect().finally(() => {
      for (const s of streams.values()) s.end();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
