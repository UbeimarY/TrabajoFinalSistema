/**
 * global_dashboard_worker  –  vm-app
 *
 * RabbitMQ Fanout consumer + HTTP SSE server.
 *
 * Fanout binding:
 *   exchange  global_results_fanout  (published by vote-processor after each
 *             batch, carrying { totals: { [candidate]: number }, snapshot_at })
 *
 * HTTP endpoints (port API_PORT, default 3000):
 *   GET /health          → { ok: true }
 *   GET /dashboard/live  → text/event-stream (SSE)
 *                          Pushes current global totals to every connected
 *                          client whenever the fanout delivers a new snapshot.
 *   GET /dashboard       → application/json  (pull, latest snapshot)
 *
 * The worker declares its own exclusive, auto-delete queue bound to the
 * fanout exchange so that multiple replicas each receive every message.
 *
 * NOTE: vote-processor publishes to global_results_fanout after writing
 *       processed_votes.  regional-rollup-service publishes to
 *       regional_results_fanout. Both fanout exchanges must be declared
 *       before any worker binds to them; workers do the assertExchange
 *       call themselves (idempotent).
 */

import http from "node:http";
import {
  AuthClient,
  connectRabbitMqWithOAuth,
  loadTlsConfigFromEnv
} from "@zt/common";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

type GlobalSnapshot = {
  totals: Record<string, number>;
  snapshot_at: number;
};

type SseClient = {
  id: number;
  res: http.ServerResponse;
};

const EXCHANGE = "global_results_fanout";

async function main() {
  const apiPort = Number(process.env.API_PORT ?? "3000");

  const authTls = loadTlsConfigFromEnv("AUTH_TLS");
  const auth = new AuthClient({
    authBaseUrl: mustGetEnv("AUTH_BASE_URL"),
    clientId: mustGetEnv("CLIENT_ID"),
    clientSecret: mustGetEnv("CLIENT_SECRET"),
    ca: authTls.ca
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

  const channel = await amqpConn.createChannel();
  await channel.assertExchange(EXCHANGE, "fanout", { durable: true });

  // Exclusive, auto-delete queue — each replica gets its own.
  const { queue: queueName } = await channel.assertQueue("", {
    exclusive: true,
    autoDelete: true
  });
  await channel.bindQueue(queueName, EXCHANGE, "");

  // In-memory state
  let latest: GlobalSnapshot = { totals: {}, snapshot_at: 0 };
  let sseClientId = 0;
  const sseClients = new Map<number, SseClient>();

  function broadcastSse(snapshot: GlobalSnapshot): void {
    const data = JSON.stringify(snapshot);
    const frame = `data: ${data}\n\n`;
    for (const client of sseClients.values()) {
      try {
        client.res.write(frame);
      } catch {
        sseClients.delete(client.id);
      }
    }
  }

  // ── RabbitMQ consumer ──────────────────────────────────────────────────────
  await channel.consume(
    queueName,
    (msg) => {
      if (!msg) return;
      try {
        const snapshot = JSON.parse(
          msg.content.toString("utf8")
        ) as GlobalSnapshot;

        // Merge incoming snapshot into our running total.
        for (const [candidate, count] of Object.entries(snapshot.totals)) {
          latest.totals[candidate] = (latest.totals[candidate] ?? 0) + count;
        }
        latest.snapshot_at = snapshot.snapshot_at;

        broadcastSse(latest);
      } catch {
        // malformed — ignore
      }
      channel.ack(msg);
    },
    { noAck: false }
  );

  // ── HTTP server ────────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && req.url === "/dashboard") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(latest));
      return;
    }

    if (req.method === "GET" && req.url === "/dashboard/live") {
      const id = ++sseClientId;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      // Send current state immediately on connect.
      res.write(`data: ${JSON.stringify(latest)}\n\n`);
      sseClients.set(id, { id, res });
      req.on("close", () => sseClients.delete(id));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(apiPort, "0.0.0.0");

  const shutdown = () => {
    server.close();
    amqpConn.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
