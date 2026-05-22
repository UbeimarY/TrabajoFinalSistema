import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import { AuthClient, connectRabbitMqWithOAuth, createKafkaWithOAuth, loadTlsConfigFromEnv } from "@zt/common";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

type VoteRequest = {
  user_id: string;
  vote: string;
  region?: string;
};

async function main() {
  const port = Number(process.env.PORT ?? "8080");
  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsKeyPath = process.env.TLS_KEY_PATH;

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

  const kafkaBrokers = mustGetEnv("KAFKA_BROKERS").split(",").filter(Boolean);
  const kafkaTls = loadTlsConfigFromEnv("KAFKA_TLS");

  const kafka = createKafkaWithOAuth({
    clientId: "voting-api",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  const producer = kafka.producer();
  await producer.connect();

  const amqpConn = await connectRabbitMqWithOAuth({
    host: rabbitHost,
    port: rabbitPort,
    vhost: process.env.RABBIT_VHOST ?? "/",
    getToken: () => auth.getAccessToken(),
    tls: {
      ca: rabbitTls.ca,
      cert: rabbitTls.cert,
      key: rabbitTls.key,
      rejectUnauthorized: rabbitTls.rejectUnauthorized
    }
  });
  const channel = await amqpConn.createChannel();
  await channel.assertQueue("user_validation_queue", { durable: true });

  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  async function rpcValidateUser(payload: unknown): Promise<{ valid: boolean }> {
    const correlationId = randomUUID();

    return new Promise((resolve, reject) => {
      let consumerTag: string | undefined;
      const timeout = setTimeout(() => {
        if (consumerTag) channel.cancel(consumerTag).catch(() => undefined);
        reject(new Error("rpc timeout"));
      }, 5000);

      channel
        .consume(
          "amq.rabbitmq.reply-to",
          (msg: unknown) => {
            if (!msg) return;
            const m = msg as { properties: { correlationId?: string }; content: Buffer };
            if (m.properties.correlationId !== correlationId) return;
            clearTimeout(timeout);
            if (consumerTag) channel.cancel(consumerTag).catch(() => undefined);
            try {
              const parsed = JSON.parse(m.content.toString("utf8")) as { valid: boolean };
              resolve(parsed);
            } catch (e) {
              reject(e);
            }
          },
          { noAck: true }
        )
        .then((ok: { consumerTag: string }) => {
          consumerTag = ok.consumerTag ?? consumerTag;
          channel.sendToQueue("user_validation_queue", Buffer.from(JSON.stringify(payload)), {
            correlationId,
            replyTo: "amq.rabbitmq.reply-to",
            contentType: "application/json"
          });
        })
        .catch((e: unknown) => {
          clearTimeout(timeout);
          reject(e);
        });
    });
  }

  app.post("/vote", async (req, res) => {
    const body = req.body as Partial<VoteRequest>;
    if (!body.user_id || !body.vote) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    try {
      const validation = await rpcValidateUser({ user_id: body.user_id });
      if (!validation.valid) {
        res.status(403).json({ error: "user_not_eligible" });
        return;
      }

      await producer.send({
        topic: "raw_votes",
        messages: [
          {
            key: body.user_id,
            value: JSON.stringify({
              user_id: body.user_id,
              vote: body.vote,
              region: body.region ?? "unknown",
              ts: Date.now()
            }),
            headers: {
              "content-type": Buffer.from("application/json", "utf8")
            }
          }
        ]
      });

      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  if (tlsCertPath && tlsKeyPath) {
    const server = https.createServer(
      { cert: fs.readFileSync(tlsCertPath), key: fs.readFileSync(tlsKeyPath) },
      app
    );
    server.listen(port, "0.0.0.0");
  } else {
    app.listen(port, "0.0.0.0");
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

