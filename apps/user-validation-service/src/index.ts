import { AuthClient, connectRabbitMqWithOAuth, createKafkaWithOAuth, loadTlsConfigFromEnv } from "@zt/common";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

type EligibleVoter = {
  user_id: string;
  region?: string;
};

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
    clientId: "user-validation-service",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  const voterSet = new Set<string>();

  const consumer = kafka.consumer({ groupId: "user-validation-service" });
  await consumer.connect();
  await consumer.subscribe({ topic: "eligible_voters", fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const v = JSON.parse(message.value.toString("utf8")) as EligibleVoter;
        if (v.user_id) voterSet.add(v.user_id);
      } catch {
        return;
      }
    }
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
  await channel.assertQueue("user_validation_queue", { durable: true });
  await channel.prefetch(50);

  await channel.consume(
    "user_validation_queue",
    async (msg) => {
      if (!msg) return;
      let userId: string | undefined;
      try {
        const payload = JSON.parse(msg.content.toString("utf8")) as { user_id?: string };
        userId = payload.user_id;
      } catch {
        userId = undefined;
      }

      const valid = Boolean(userId && voterSet.has(userId));
      const replyTo = msg.properties.replyTo;
      const correlationId = msg.properties.correlationId;

      if (replyTo && correlationId) {
        channel.sendToQueue(replyTo, Buffer.from(JSON.stringify({ valid })), {
          correlationId,
          contentType: "application/json"
        });
      }

      channel.ack(msg);
    },
    { noAck: false }
  );
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

