import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

type SimulatedProvider = "google" | "facebook";
type GoogleProtocolFault =
  | "forged_signature"
  | "userinfo_subject_mismatch"
  | "wrong_nonce";

const GOOGLE_PROTOCOL_FAULTS = new Set<GoogleProtocolFault>([
  "forged_signature",
  "userinfo_subject_mismatch",
  "wrong_nonce",
]);

interface PendingCode {
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly fault?: GoogleProtocolFault;
  readonly nonce?: string;
  readonly provider: SimulatedProvider;
  readonly redirectUri: string;
  readonly subject: string;
}

interface AccessIdentity {
  readonly provider: SimulatedProvider;
  readonly subject: string;
}

export interface OAuthProviderSimulator {
  readonly origin: string;
  close(): Promise<void>;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > 64_000) throw new Error("request body too large");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export async function startOAuthProviderSimulator(
  port = 0,
): Promise<OAuthProviderSimulator> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const { privateKey: forgedPrivateKey } = await generateKeyPair("RS256");
  const publicJwk: JWK = await exportJWK(publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "unit01-google-key";
  publicJwk.use = "sig";
  const codes = new Map<string, PendingCode>();
  const accessTokens = new Map<string, AccessIdentity>();
  let origin = "";

  const server: Server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", origin || "http://127.0.0.1");
      if (requestUrl.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      const match = requestUrl.pathname.match(
        /^\/(google|facebook)\/(authorize|decision|token|jwks|userinfo)$/u,
      );
      if (!match) {
        response.writeHead(404).end("Not found");
        return;
      }
      const provider = match[1] as SimulatedProvider;
      const action = match[2];
      const issuer = `${origin}/${provider}`;

      if (action === "authorize") {
        const required = [
          "client_id",
          "redirect_uri",
          "state",
          "code_challenge",
          "code_challenge_method",
        ] as const;
        if (
          required.some((key) => !requestUrl.searchParams.get(key)) ||
          requestUrl.searchParams.get("response_type") !== "code" ||
          requestUrl.searchParams.get("code_challenge_method") !== "S256" ||
          (provider === "google" && !requestUrl.searchParams.get("nonce"))
        ) {
          response.writeHead(400).end("Invalid authorization request");
          return;
        }
        const query = requestUrl.searchParams.toString();
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
          "Content-Type": "text/html; charset=utf-8",
          "Referrer-Policy": "no-referrer",
        });
        response.end(`<!doctype html><html lang="uk"><meta charset="utf-8"><title>OAuth simulator</title><style>body{font-family:system-ui;padding:3rem}a{display:inline-block;margin:.5rem;padding:1rem;border:1px solid;border-radius:999px}</style><h1>${htmlEscape(provider)} consent simulator</h1><a data-decision="approve" href="/${provider}/decision?decision=approve&amp;${htmlEscape(query)}">Підтвердити</a><a data-decision="deny" href="/${provider}/decision?decision=deny&amp;${htmlEscape(query)}">Відхилити</a></html>`);
        return;
      }

      if (action === "decision") {
        const redirectUri = requestUrl.searchParams.get("redirect_uri");
        const state = requestUrl.searchParams.get("state");
        const requestedFault = requestUrl.searchParams.get("fault");
        const fault = requestedFault as GoogleProtocolFault | null;
        if (!redirectUri || !state) {
          response.writeHead(400).end("Invalid decision");
          return;
        }
        if (
          requestedFault &&
          (provider !== "google" || !GOOGLE_PROTOCOL_FAULTS.has(fault!))
        ) {
          response.writeHead(400).end("Invalid protocol fault");
          return;
        }
        const callback = new URL(redirectUri);
        callback.searchParams.set("state", state);
        callback.searchParams.set("iss", issuer);
        if (requestUrl.searchParams.get("decision") === "deny") {
          callback.searchParams.set("error", "access_denied");
        } else {
          const code = randomUUID();
          codes.set(code, {
            clientId: requestUrl.searchParams.get("client_id") ?? "",
            codeChallenge: requestUrl.searchParams.get("code_challenge") ?? "",
            fault: fault ?? undefined,
            nonce: requestUrl.searchParams.get("nonce") ?? undefined,
            provider,
            redirectUri,
            subject: `${provider}-simulated-subject`,
          });
          callback.searchParams.set("code", code);
        }
        response.writeHead(302, { Location: callback.toString() }).end();
        return;
      }

      if (action === "token") {
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        const form = new URLSearchParams(await readBody(request));
        const code = form.get("code") ?? "";
        const pending = codes.get(code);
        const expectedClientId = `${provider}-client`;
        const expectedClientSecret = `${provider}-secret`;
        if (
          !pending ||
          pending.provider !== provider ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== expectedClientId ||
          form.get("client_secret") !== expectedClientSecret ||
          form.get("redirect_uri") !== pending.redirectUri ||
          pkceChallenge(form.get("code_verifier") ?? "") !== pending.codeChallenge
        ) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
        codes.delete(code);
        const accessToken = randomUUID();
        accessTokens.set(accessToken, {
          provider,
          subject:
            pending.fault === "userinfo_subject_mismatch"
              ? `${pending.subject}-userinfo-mismatch`
              : pending.subject,
        });
        const body: Record<string, unknown> = {
          access_token: accessToken,
          expires_in: 300,
          token_type: "Bearer",
        };
        if (provider === "google") {
          body.id_token = await new SignJWT({
            email: "google-private@simulator.test",
            email_verified: true,
            name: "Google Private Simulator",
            nonce:
              pending.fault === "wrong_nonce"
                ? `${pending.nonce ?? "missing"}-wrong`
                : pending.nonce,
          })
            .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
            .setIssuer(issuer)
            .setAudience(pending.clientId)
            .setSubject(pending.subject)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(
              pending.fault === "forged_signature"
                ? forgedPrivateKey
                : privateKey,
            );
        }
        sendJson(response, 200, body);
        return;
      }

      if (action === "jwks" && provider === "google") {
        sendJson(response, 200, { keys: [publicJwk] });
        return;
      }

      if (action === "userinfo") {
        const authorization = request.headers.authorization;
        const accessToken = authorization?.match(/^Bearer (.+)$/u)?.[1];
        const identity = accessToken ? accessTokens.get(accessToken) : undefined;
        if (!identity || identity.provider !== provider) {
          response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
          return;
        }
        sendJson(
          response,
          200,
          provider === "google"
            ? {
                email: "google-private@simulator.test",
                email_verified: true,
                name: "Google Private Simulator",
                sub: identity.subject,
              }
            : {
                email: "facebook-private@simulator.test",
                id: identity.subject,
                name: "Facebook Private Simulator",
              },
        );
        return;
      }

      response.writeHead(404).end("Not found");
    } catch {
      response.writeHead(500).end("Simulator error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Simulator did not bind a TCP port");
  }
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const requestedPort = Number(process.argv[2] ?? 3200);
  const simulator = await startOAuthProviderSimulator(requestedPort);
  process.stdout.write(`OAuth provider simulator listening on ${simulator.origin}\n`);
}
