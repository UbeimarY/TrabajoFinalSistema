/**
 * regional_dashboard_worker  –  vm-app
 *
 * RabbitMQ Fanout consumer + HTTP server.
 *
 * Fanout binding:
 *   exchange  regional_results_fanout
 *   payload   { region, totals: { [candidate]: count }, snapshot_at }
 *             (published by regional-rollup-service)
 *
 * HTTP endpoints (port API_PORT, default 3001):
 *   GET /health                   → { ok: true }
 *   GET /dashboard/regional       → { regions: { [region]: { [candidate]: count } }, snapshot_at }
 *   GET /dashboard/regional/:reg  → { region, totals, snapshot_at }
 *   GET /dashboard/regional/live  → text/event-stream (SSE) — full state on every update
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

type RegionalSnapshot = {
  region: string;
  totals: Record<string, number>;
  snapshot_at: number;
};

type SseClient = {
  id: number;
  res: http.ServerResponse;
};

const EXCHANGE = "regional_results_fanout";

async function main() {
  const apiPort = Number(process.env.API_PORT ?? "3001");

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

  const { queue: queueName } = await channel.assertQueue("", {
    exclusive: true,
    autoDelete: true
  });
  await channel.bindQueue(queueName, EXCHANGE, "");

  // KTable: region → candidate → running total
  const regionalState = new Map<string, Map<string, number>>();
  let lastSnapshotAt = 0;
  let sseClientId = 0;
  const sseClients = new Map<number, SseClient>();

  function buildFullState() {
    const regions: Record<string, Record<string, number>> = {};
    for (const [region, totals] of regionalState) {
      regions[region] = Object.fromEntries(totals);
    }
    return { regions, snapshot_at: lastSnapshotAt };
  }

  function broadcastSse(): void {
    const data = JSON.stringify(buildFullState());
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
        const snap = JSON.parse(
          msg.content.toString("utf8")
        ) as RegionalSnapshot;

        if (!snap.region || typeof snap.totals !== "object") {
          channel.ack(msg);
          return;
        }

        if (!regionalState.has(snap.region)) {
          regionalState.set(snap.region, new Map());
        }
        const regionMap = regionalState.get(snap.region)!;
        for (const [candidate, count] of Object.entries(snap.totals)) {
          regionMap.set(candidate, (regionMap.get(candidate) ?? 0) + count);
        }
        lastSnapshotAt = snap.snapshot_at;

        broadcastSse();
      } catch {
        // malformed — ignore
      }
      channel.ack(msg);
    },
    { noAck: false }
  );

  // ── HTTP server ────────────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === "GET" && url === "/dashboard/regional") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildFullState()));
      return;
    }

    if (method === "GET" && url === "/dashboard/regional/live") {
      const id = ++sseClientId;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write(`data: ${JSON.stringify(buildFullState())}\n\n`);
      sseClients.set(id, { id, res });
      req.on("close", () => sseClients.delete(id));
      return;
    }

    // /dashboard/regional/:region
    const regionMatch = /^\/dashboard\/regional\/([^/]+)$/.exec(url);
    if (method === "GET" && regionMatch) {
      const region = decodeURIComponent(regionMatch[1]!);
      const totals = regionalState.get(region);
      if (!totals) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "region_not_found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ region, totals: Object.fromEntries(totals), snapshot_at: lastSnapshotAt })
      );
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
