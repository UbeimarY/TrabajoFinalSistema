import { Kafka, type KafkaConfig, type SASLOptions } from "kafkajs";

export type KafkaOAuthConfig = {
  brokers: string[];
  clientId: string;
  ssl: KafkaConfig["ssl"];
  getToken: () => Promise<string>;
};

export function createKafkaWithOAuth(cfg: KafkaOAuthConfig): Kafka {
  const sasl: SASLOptions = {
    mechanism: "oauthbearer",
    oauthBearerProvider: async () => {
      const token = await cfg.getToken();
      return { value: token };
    }
  };

  return new Kafka({
    clientId: cfg.clientId,
    brokers: cfg.brokers,
    ssl: cfg.ssl,
    sasl
  });
}

