import fs from "node:fs";
import https from "node:https";
import express from "express";
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

type ClientRecord = {
  secret: string;
  scopes: string[];
};

type ClientsDb = Record<string, ClientRecord>;

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function parseClientsDb(): ClientsDb {
  const raw = mustGetEnv("CLIENTS_JSON");
  const parsed = JSON.parse(raw) as ClientsDb;
  return parsed;
}

async function main() {
  const port = Number(process.env.PORT ?? "443");
  const issuer = mustGetEnv("JWT_ISSUER");
  const audience = (process.env.JWT_AUDIENCE ?? "kafka,rabbitmq").split(",").filter(Boolean);
  const ttlSeconds = Number(process.env.JWT_TTL_SECONDS ?? "300");
  const clients = parseClientsDb();

  const tlsCertPath = mustGetEnv("TLS_CERT_PATH");
  const tlsKeyPath = mustGetEnv("TLS_KEY_PATH");
  const privateKeyPath = mustGetEnv("JWT_PRIVATE_KEY_PATH");
  const publicKeyPath = mustGetEnv("JWT_PUBLIC_KEY_PATH");
  const kid = mustGetEnv("JWT_KID");

  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const privateKey = await importPKCS8(privateKeyPem, "RS256");
  const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");
  const publicKey = await importSPKI(publicKeyPem, "RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  publicJwk.kid = kid;

  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.status(200).json({ keys: [publicJwk] });
  });

  app.post("/token", async (req, res) => {
    const body = req.body as Partial<{ client_id: string; client_secret: string }>;
    if (!body.client_id || !body.client_secret) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const record = clients[body.client_id];
    if (!record || record.secret !== body.client_secret) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ scope: record.scopes.join(" ") })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setSubject(body.client_id)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(privateKey);

    res.status(200).json({
      access_token: token,
      token_type: "Bearer",
      expires_in: ttlSeconds
    });
  });

  app.post("/introspect", async (req, res) => {
    const body = req.body as Partial<{ token: string }>;
    if (!body.token) {
      res.status(400).json({ active: false });
      return;
    }

    try {
      const verified = await jwtVerify(body.token, publicKey, {
        issuer,
        audience
      });
      res.status(200).json({ active: true, claims: verified.payload });
    } catch {
      res.status(200).json({ active: false });
    }
  });

  const server = https.createServer(
    {
      cert: fs.readFileSync(tlsCertPath),
      key: fs.readFileSync(tlsKeyPath)
    },
    app
  );

  server.listen(port, "0.0.0.0");
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

