import fs from "node:fs";

export type TlsClientConfig = {
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
};

export function loadTlsConfigFromEnv(prefix: string): TlsClientConfig {
  const caPath = process.env[`${prefix}_CA_PATH`];
  const certPath = process.env[`${prefix}_CERT_PATH`];
  const keyPath = process.env[`${prefix}_KEY_PATH`];
  const rejectUnauthorizedRaw = process.env[`${prefix}_REJECT_UNAUTHORIZED`];

  return {
    ca: caPath ? fs.readFileSync(caPath, "utf8") : undefined,
    cert: certPath ? fs.readFileSync(certPath, "utf8") : undefined,
    key: keyPath ? fs.readFileSync(keyPath, "utf8") : undefined,
    rejectUnauthorized:
      rejectUnauthorizedRaw === undefined ? true : rejectUnauthorizedRaw !== "false"
  };
}

