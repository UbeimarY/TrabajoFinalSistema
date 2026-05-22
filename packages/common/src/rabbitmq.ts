import amqp, { type Options } from "amqplib";

export type RabbitMqOAuthConfig = {
  host: string;
  port: number;
  vhost?: string;
  getToken: () => Promise<string>;
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
    servername?: string;
  };
};

export async function connectRabbitMqWithOAuth(cfg: RabbitMqOAuthConfig) {
  const token = await cfg.getToken();
  const vhost = cfg.vhost ?? "/";

  const url =
    `amqps://ignored:${encodeURIComponent(token)}` +
    `@${cfg.host}:${cfg.port}${vhost === "/" ? "" : `/${encodeURIComponent(vhost)}`}`;

  const socketOptions = {
    ca: cfg.tls?.ca,
    cert: cfg.tls?.cert,
    key: cfg.tls?.key,
    rejectUnauthorized: cfg.tls?.rejectUnauthorized ?? true,
    servername: cfg.tls?.servername
  } as unknown as Options.Connect;

  return amqp.connect(url, socketOptions);
}

