import { randomUUID } from "node:crypto";
import { AuthClient, createKafkaWithOAuth, loadTlsConfigFromEnv } from "@zt/common";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

type EligibleVoter = {
  user_id: string;
  region: string;
  created_at: number;
};

function randomRegion(): string {
  const regions = ["north", "south", "east", "west", "central"];
  return regions[Math.floor(Math.random() * regions.length)] ?? "central";
}

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
    clientId: "voter-registration-service",
    brokers: kafkaBrokers,
    ssl: kafkaTls.ca
      ? { ca: [kafkaTls.ca], rejectUnauthorized: kafkaTls.rejectUnauthorized }
      : undefined,
    getToken: () => auth.getAccessToken()
  });

  const producer = kafka.producer();
  await producer.connect();

  const count = Number(process.env.SEED_COUNT ?? "50");
  const voters: EligibleVoter[] = Array.from({ length: count }).map(() => ({
    user_id: randomUUID(),
    region: randomRegion(),
    created_at: Date.now()
  }));

  await producer.send({
    topic: "eligible_voters",
    messages: voters.map((v) => ({
      key: v.user_id,
      value: JSON.stringify(v),
      headers: { "content-type": Buffer.from("application/json", "utf8") }
    }))
  });

  await producer.disconnect();
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

