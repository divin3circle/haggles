/**
 * Haggles Portal API routes (`/portal/v1/*`) and PayPal Webhook route (`POST /webhooks/paypal`).
 *
 * Implements SPEC.md sections 5.2, 7.1, 7.2, 8.3, 8.4, 8.5, and 11.
 * Every route has a TypeBox schema and an OpenAPI description (SPEC.md section 0.2 rule 4).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { type Static, Type } from "@sinclair/typebox";
import { formatMoney, HagglesError, parseMoney } from "@haggles/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiConfig } from "../config.js";
import type { AccountRecord, FacilitatorService, SessionRecord } from "../services/facilitator.js";
import { ProblemDetailsSchema } from "./protocol.js";

/**
 * Parses a raw `Cookie` header string into a key-value map.
 *
 * @param cookieHeader - Raw `Cookie` request header
 * @returns Record of decoded cookie names and values
 *
 * @example
 * ```ts
 * const cookies = parseCookies("hg_session=abc; hg_csrf=xyz");
 * ```
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) {
      try {
        out[name] = decodeURIComponent(val);
      } catch {
        out[name] = val;
      }
    }
  }
  return out;
}

/**
 * Builds `Set-Cookie` headers for `hg_session` (HttpOnly) and `hg_csrf` (readable by JS for double-submit CSRF, SPEC.md section 8.3).
 *
 * @param sessionToken - Raw opaque session token
 * @param csrfToken - Raw CSRF double-submit token
 * @param maxAgeSec - Cookie max-age in seconds
 * @returns Tuple of `[sessionCookie, csrfCookie]` strings
 *
 * @example
 * ```ts
 * const [s, c] = buildSessionCookieHeaders("tok", "csrf", 604800);
 * ```
 */
export function buildSessionCookieHeaders(
  sessionToken: string,
  csrfToken: string,
  maxAgeSec: number = 7 * 24 * 60 * 60,
  secure: boolean = true,
): [string, string] {
  const secureFlag = secure ? " Secure;" : "";
  const sessionCookie = `hg_session=${encodeURIComponent(sessionToken)}; HttpOnly;${secureFlag} SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
  const csrfCookie = `hg_csrf=${encodeURIComponent(csrfToken)};${secureFlag} SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
  return [sessionCookie, csrfCookie];
}

/**
 * Paginates an in-memory ordered array using an opaque item ID cursor (SPEC.md section 5).
 *
 * @param items - Ordered list of items with `id`
 * @param limit - Page size (clamped to `1..100`, default `50`)
 * @param cursor - Optional cursor (`id` of last item from previous page)
 * @returns `{ data, next_cursor }`
 *
 * @example
 * ```ts
 * const page = paginateByCursor(items, 25, undefined);
 * ```
 */
export function paginateByCursor<T extends { id: string }>(
  items: T[],
  limit: number = 50,
  cursor?: string,
): { data: T[]; next_cursor: string | null } {
  const clampedLimit = Math.min(Math.max(limit, 1), 100);
  let startIdx = 0;
  if (cursor) {
    const foundIdx = items.findIndex((item) => item.id === cursor);
    if (foundIdx >= 0) {
      startIdx = foundIdx + 1;
    }
  }
  const slice = items.slice(startIdx, startIdx + clampedLimit);
  const hasMore = startIdx + clampedLimit < items.length;
  const lastItem = slice[slice.length - 1];
  return {
    data: slice,
    next_cursor: hasMore && lastItem ? lastItem.id : null,
  };
}

const IdParamsSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DaysQuerySchema = Type.Object(
  {
    days: Type.Optional(Type.Integer({ minimum: 1, maximum: 90, default: 30 })),
  },
  { additionalProperties: false },
);

const CursorQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const BuyerPaymentsQuerySchema = Type.Object(
  {
    key: Type.Optional(Type.String()),
    seller: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const SellerCallsQuerySchema = Type.Object(
  {
    endpoint: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const UpdateMeBodySchema = Type.Object(
  {
    display_name: Type.Optional(Type.String({ maxLength: 100 })),
    is_buyer: Type.Optional(Type.Boolean()),
    is_seller: Type.Optional(Type.Boolean()),
    revoke_all_sessions: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const CreateAgentKeyBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 60 }),
    per_call_max: Type.Optional(Type.String()),
    daily_max: Type.Optional(Type.String()),
    monthly_max: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    allowed_sellers: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
    allowed_hosts: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
    expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

const UpdateAgentKeyBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    per_call_max: Type.Optional(Type.String()),
    daily_max: Type.Optional(Type.String()),
    monthly_max: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    allowed_sellers: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
    allowed_hosts: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
    expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

const CreateTopupBodySchema = Type.Object(
  {
    amount: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const CreateSellerKeyBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 60 }),
  },
  { additionalProperties: false },
);

const UpdateEndpointBodySchema = Type.Object(
  {
    display_name: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("hidden")])),
  },
  { additionalProperties: false },
);

/**
 * Registers all Portal API routes (`/portal/v1/*`) and PayPal Webhook routes (`POST /webhooks/paypal`)
 * on a Fastify instance (SPEC.md sections 5.2, 7, 8.3, 8.4, 8.5).
 *
 * @param app - Fastify instance
 * @param facilitator - {@link FacilitatorService} instance
 * @param config - {@link ApiConfig} instance
 *
 * @example
 * ```ts
 * await registerPortalRoutes(app, facilitator, config);
 * ```
 */
export async function registerPortalRoutes(
  app: FastifyInstance,
  facilitator: FacilitatorService,
  config: ApiConfig,
): Promise<void> {
  const requireAuth = (request: FastifyRequest): { account: AccountRecord; session: SessionRecord } => {
    const cookies = parseCookies(request.headers.cookie);
    const csrfHeader =
      typeof request.headers["x-haggles-csrf"] === "string"
        ? request.headers["x-haggles-csrf"]
        : undefined;
    const originHeader =
      typeof request.headers.origin === "string" ? request.headers.origin : undefined;

    return facilitator.authenticateSession({
      sessionToken: cookies.hg_session,
      method: request.method,
      csrfCookie: cookies.hg_csrf,
      csrfHeader,
      originHeader,
    });
  };

  // ---------------------------------------------------------------------------
  // Auth & Account (/portal/v1/auth/*, /portal/v1/me)
  // ---------------------------------------------------------------------------

  app.get(
    "/portal/v1/auth/paypal/start",
    {
      schema: {
        tags: ["portal"],
        summary: "Start Log in with PayPal authorization flow",
        description:
          "Generates a cryptographic OAuth2 state cookie and redirects (or returns the authorize URL) for Log in with PayPal (SPEC.md sections 5.2 and 8.3).",
      },
    },
    async (request, reply) => {
      const state = randomBytes(24).toString("base64url");
      const redirectUri =
        config.PAYPAL_OIDC_REDIRECT_URI ??
        `${config.PUBLIC_PORTAL_URL.replace(/\/$/, "")}/portal/v1/auth/paypal/callback`;
      const authorizeUrl = facilitator.buildPayPalAuthorizeUrl(state, redirectUri);
      const secureCookie =
        config.PUBLIC_PORTAL_URL.startsWith("https://") || config.NODE_ENV !== "development";
      const secureFlag = secureCookie ? " Secure;" : "";

      reply.header(
        "set-cookie",
        `hg_oauth_state=${encodeURIComponent(state)}; HttpOnly;${secureFlag} SameSite=Lax; Path=/; Max-Age=600`,
      );

      if (request.headers.accept?.includes("application/json")) {
        return { authorize_url: authorizeUrl, state };
      }
      return reply.redirect(authorizeUrl);
    },
  );

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>(
    "/portal/v1/auth/paypal/callback",
    {
      schema: {
        tags: ["portal"],
        summary: "Complete Log in with PayPal authorization callback",
        description:
          "Verifies the OAuth2 state cookie, exchanges the authorization code with PayPal, fetches userinfo (`payer_id`, primary confirmed email, `verified_account`), and sets `hg_session` and `hg_csrf` cookies (SPEC.md sections 5.2 and 8.3).",
        querystring: Type.Object({
          code: Type.Optional(Type.String()),
          state: Type.Optional(Type.String()),
          error: Type.Optional(Type.String()),
          error_description: Type.Optional(Type.String()),
        }),
      },
    },
    async (request, reply) => {
      const wantsJson = Boolean(request.headers.accept?.includes("application/json"));
      const portalBase = config.PUBLIC_PORTAL_URL.replace(/\/$/, "");
      const secureCookie =
        config.PUBLIC_PORTAL_URL.startsWith("https://") || config.NODE_ENV !== "development";
      const secureFlag = secureCookie ? " Secure;" : "";

      try {
        const { code, state, error, error_description } = request.query;
        if (error) {
          throw new HagglesError(error_description || `PayPal returned OAuth error: ${error}`, {
            code: "unauthorized",
            status: 401,
          });
        }
        if (!code || !state) {
          throw new HagglesError("Missing OAuth2 code or state parameter.", {
            code: "unauthorized",
            status: 401,
          });
        }

        const cookies = parseCookies(request.headers.cookie);
        const cookieState = cookies.hg_oauth_state;
        if (!cookieState) {
          throw new HagglesError("Missing OAuth2 state cookie.", {
            code: "unauthorized",
            status: 401,
          });
        }

        const a = Buffer.from(cookieState, "utf8");
        const b = Buffer.from(state, "utf8");
        if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
          throw new HagglesError("OAuth2 state parameter mismatch.", {
            code: "unauthorized",
            status: 401,
          });
        }

        const redirectUri =
          config.PAYPAL_OIDC_REDIRECT_URI ?? `${portalBase}/portal/v1/auth/paypal/callback`;
        const loginResult = await facilitator.loginWithPayPalCode({
          code,
          redirectUri,
          userAgent: request.headers["user-agent"],
          ip: request.ip,
        });

        const [sessionCookie, csrfCookie] = buildSessionCookieHeaders(
          loginResult.sessionToken,
          loginResult.csrfToken,
          7 * 24 * 60 * 60,
          secureCookie,
        );
        const clearStateCookie = `hg_oauth_state=; HttpOnly;${secureFlag} SameSite=Lax; Path=/; Max-Age=0`;
        reply.header("set-cookie", [sessionCookie, csrfCookie, clearStateCookie]);

        const nextPath =
          !loginResult.account.isBuyer && !loginResult.account.isSeller
            ? "/onboarding"
            : loginResult.account.isBuyer
              ? "/buy"
              : "/sell";

        if (wantsJson) {
          return {
            account: {
              id: loginResult.account.id,
              email: loginResult.account.email,
              display_name: loginResult.account.displayName,
              paypal_payer_id: loginResult.account.paypalPayerId,
              paypal_verified_account: loginResult.account.paypalVerifiedAccount,
              is_buyer: loginResult.account.isBuyer,
              is_seller: loginResult.account.isSeller,
            },
            is_new_account: loginResult.isNewAccount,
            redirect_to: nextPath,
          };
        }
        return reply.redirect(`${portalBase}${nextPath}`);
      } catch (err) {
        if (!wantsJson && request.headers.accept?.includes("text/html")) {
          const msg = err instanceof Error ? err.message : "PayPal sign-in failed.";
          return reply.redirect(`${portalBase}/login?error=${encodeURIComponent(msg)}`);
        }
        throw err;
      }
    },
  );

  app.post(
    "/portal/v1/auth/logout",
    {
      schema: {
        tags: ["portal"],
        summary: "Log out current portal session",
        description:
          "Invalidates the current `hg_session` token and clears session/CSRF cookies (SPEC.md sections 5.2 and 8.3).",
      },
    },
    async (request, reply) => {
      requireAuth(request);
      const cookies = parseCookies(request.headers.cookie);
      facilitator.logoutSession(cookies.hg_session);
      reply.header("set-cookie", [
        "hg_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        "hg_csrf=; Secure; SameSite=Lax; Path=/; Max-Age=0",
      ]);
      return { logged_out: true };
    },
  );

  app.get(
    "/portal/v1/me",
    {
      schema: {
        tags: ["portal"],
        summary: "Read current authenticated account profile and roles",
        description:
          "Returns the authenticated account profile, enabled roles (`is_buyer`, `is_seller`), wallet ID, seller ID, and environment mode (SPEC.md sections 5.2 and 11.6).",
      },
    },
    async (request, reply) => {
      const { account, session } = requireAuth(request);
      const secureCookie =
        config.PUBLIC_PORTAL_URL.startsWith("https://") || config.NODE_ENV !== "development";
      const secureFlag = secureCookie ? " Secure;" : "";
      reply.header(
        "set-cookie",
        `hg_csrf=${encodeURIComponent(session.csrfToken)};${secureFlag} SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
      );

      let walletId: string | null = null;
      let sellerId: string | null = null;
      if (account.isBuyer) {
        try {
          walletId = facilitator.getWalletForAccount(account.id).id;
        } catch {
          walletId = null;
        }
      }
      if (account.isSeller) {
        try {
          sellerId = facilitator.getSellerForAccount(account.id).id;
        } catch {
          sellerId = null;
        }
      }

      return {
        id: account.id,
        email: account.email,
        display_name: account.displayName,
        paypal_payer_id: account.paypalPayerId,
        paypal_verified_account: account.paypalVerifiedAccount,
        is_buyer: account.isBuyer,
        is_seller: account.isSeller,
        status: account.status,
        wallet_id: walletId,
        seller_id: sellerId,
        environment: {
          haggles_env: config.HAGGLES_ENV,
          paypal_mode: config.PAYPAL_MODE,
          public_api_url: config.PUBLIC_API_URL,
        },
      };
    },
  );

  app.patch<{
    Body: Static<typeof UpdateMeBodySchema>;
  }>(
    "/portal/v1/me",
    {
      schema: {
        tags: ["portal"],
        summary: "Update current account profile and Buyer/Seller roles",
        description:
          "Updates `display_name`, `is_buyer`, and `is_seller` roles, provisioning wallet/seller records as needed and enforcing non-zero balance role guards (SPEC.md sections 5.2, 11.3, 11.6).",
        body: UpdateMeBodySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      if (request.body.revoke_all_sessions) {
        facilitator.revokeAllAccountSessions(account.id);
      }
      const updated = await facilitator.updateAccountProfile({
        accountId: account.id,
        displayName: request.body.display_name,
        isBuyer: request.body.is_buyer,
        isSeller: request.body.is_seller,
      });
      return {
        id: updated.account.id,
        email: updated.account.email,
        display_name: updated.account.displayName,
        paypal_payer_id: updated.account.paypalPayerId,
        paypal_verified_account: updated.account.paypalVerifiedAccount,
        is_buyer: updated.account.isBuyer,
        is_seller: updated.account.isSeller,
        wallet_id: updated.wallet?.id ?? null,
        seller_id: updated.seller?.id ?? null,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Buyer Routes (/portal/v1/buyer/*)
  // ---------------------------------------------------------------------------

  app.get(
    "/portal/v1/buyer/summary",
    {
      schema: {
        tags: ["portal"],
        summary: "Buyer overview summary",
        description:
          "Returns available and held balance, in-flight hold count, today's spend, smallest daily key cap, 30-day spend, and recent payments (SPEC.md sections 5.2 and 11.4).",
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      return facilitator.getBuyerSummary(account.id);
    },
  );

  app.get<{
    Querystring: Static<typeof DaysQuerySchema>;
  }>(
    "/portal/v1/buyer/spend-series",
    {
      schema: {
        tags: ["portal"],
        summary: "Buyer daily spend time-series",
        description:
          "Returns daily spend totals over the requested number of UTC days (default 30, SPEC.md sections 5.2 and 11.4).",
        querystring: DaysQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const series = facilitator.getBuyerSpendSeries(account.id, request.query.days ?? 30);
      return { data: series };
    },
  );

  app.get(
    "/portal/v1/buyer/keys",
    {
      schema: {
        tags: ["portal"],
        summary: "List buyer agent keys",
        description:
          "Lists all agent keys belonging to the authenticated buyer's wallet along with today's spend per key (SPEC.md sections 5.2 and 11.4).",
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const keys = facilitator.listAgentKeysForWallet(wallet.id);
      const todayStr = new Date().toISOString().slice(0, 10);
      return {
        data: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          per_call_max: formatMoney(k.perCallMaxMicros),
          daily_max: formatMoney(k.dailyMaxMicros),
          monthly_max: k.monthlyMaxMicros !== null ? formatMoney(k.monthlyMaxMicros) : null,
          allowed_sellers: k.allowedSellers,
          allowed_hosts: k.allowedHosts,
          expires_at: k.expiresAt ? k.expiresAt.toISOString() : null,
          spent_today: formatMoney(facilitator.getSpentMicros(k.id, "day", todayStr)),
          status: k.status,
          last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          revoked_at: k.revokedAt ? k.revokedAt.toISOString() : null,
          created_at: k.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post<{
    Body: Static<typeof CreateAgentKeyBodySchema>;
  }>(
    "/portal/v1/buyer/keys",
    {
      schema: {
        tags: ["portal"],
        summary: "Create a buyer agent key",
        description:
          "Issues a new `hgk_<env>_...` agent key with spending policy caps. Returns the full secret key once at creation (SPEC.md sections 5.2, 5.3, 8.1, 11.4).",
        body: CreateAgentKeyBodySchema,
      },
    },
    async (request, reply) => {
      const { account } = requireAuth(request);
      if (!account.isBuyer) {
        await facilitator.updateAccountProfile({ accountId: account.id, isBuyer: true });
      }
      const wallet = facilitator.getWalletForAccount(account.id);
      const { record, fullKey } = facilitator.createAgentKey({
        walletId: wallet.id,
        name: request.body.name,
        perCallMaxMicros:
          request.body.per_call_max !== undefined
            ? parseMoney(request.body.per_call_max)
            : undefined,
        dailyMaxMicros:
          request.body.daily_max !== undefined ? parseMoney(request.body.daily_max) : undefined,
        monthlyMaxMicros:
          request.body.monthly_max !== undefined
            ? request.body.monthly_max === null
              ? null
              : parseMoney(request.body.monthly_max)
            : undefined,
        allowedSellers: request.body.allowed_sellers,
        allowedHosts: request.body.allowed_hosts,
        expiresAt:
          request.body.expires_at !== undefined
            ? request.body.expires_at === null
              ? null
              : new Date(request.body.expires_at)
            : undefined,
      });
      await facilitator.persistAgentKey(record);

      return reply.status(201).send({
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        key: fullKey,
        per_call_max: formatMoney(record.perCallMaxMicros),
        daily_max: formatMoney(record.dailyMaxMicros),
        monthly_max:
          record.monthlyMaxMicros !== null ? formatMoney(record.monthlyMaxMicros) : null,
        allowed_sellers: record.allowedSellers,
        allowed_hosts: record.allowedHosts,
        expires_at: record.expiresAt ? record.expiresAt.toISOString() : null,
        status: record.status,
        created_at: record.createdAt.toISOString(),
      });
    },
  );

  app.get<{
    Params: Static<typeof IdParamsSchema>;
  }>(
    "/portal/v1/buyer/keys/:id",
    {
      schema: {
        tags: ["portal"],
        summary: "Read a buyer agent key",
        description:
          "Returns a single agent key owned by the authenticated buyer (`404` if owned by another tenant, SPEC.md sections 5.2 and 8.4).",
        params: IdParamsSchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const k = facilitator.getAgentKeyForWallet(wallet.id, request.params.id);
      const todayStr = new Date().toISOString().slice(0, 10);
      return {
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        per_call_max: formatMoney(k.perCallMaxMicros),
        daily_max: formatMoney(k.dailyMaxMicros),
        monthly_max: k.monthlyMaxMicros !== null ? formatMoney(k.monthlyMaxMicros) : null,
        allowed_sellers: k.allowedSellers,
        allowed_hosts: k.allowedHosts,
        expires_at: k.expiresAt ? k.expiresAt.toISOString() : null,
        spent_today: formatMoney(facilitator.getSpentMicros(k.id, "day", todayStr)),
        status: k.status,
        last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        revoked_at: k.revokedAt ? k.revokedAt.toISOString() : null,
        created_at: k.createdAt.toISOString(),
      };
    },
  );

  app.patch<{
    Params: Static<typeof IdParamsSchema>;
    Body: Static<typeof UpdateAgentKeyBodySchema>;
  }>(
    "/portal/v1/buyer/keys/:id",
    {
      schema: {
        tags: ["portal"],
        summary: "Update a buyer agent key policy",
        description:
          "Updates an agent key's name and spending policy fields (`404` if owned by another tenant, SPEC.md sections 5.2 and 8.4).",
        params: IdParamsSchema,
        body: UpdateAgentKeyBodySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const k = facilitator.updateAgentKeyForWallet(wallet.id, request.params.id, {
        name: request.body.name,
        perCallMaxMicros:
          request.body.per_call_max !== undefined
            ? parseMoney(request.body.per_call_max)
            : undefined,
        dailyMaxMicros:
          request.body.daily_max !== undefined ? parseMoney(request.body.daily_max) : undefined,
        monthlyMaxMicros:
          request.body.monthly_max !== undefined
            ? request.body.monthly_max === null
              ? null
              : parseMoney(request.body.monthly_max)
            : undefined,
        allowedSellers: request.body.allowed_sellers,
        allowedHosts: request.body.allowed_hosts,
        expiresAt:
          request.body.expires_at !== undefined
            ? request.body.expires_at === null
              ? null
              : new Date(request.body.expires_at)
            : undefined,
      });
      await facilitator.persistAgentKeyUpdate(k);

      return {
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        per_call_max: formatMoney(k.perCallMaxMicros),
        daily_max: formatMoney(k.dailyMaxMicros),
        monthly_max: k.monthlyMaxMicros !== null ? formatMoney(k.monthlyMaxMicros) : null,
        allowed_sellers: k.allowedSellers,
        allowed_hosts: k.allowedHosts,
        expires_at: k.expiresAt ? k.expiresAt.toISOString() : null,
        status: k.status,
      };
    },
  );

  app.post<{
    Params: Static<typeof IdParamsSchema>;
  }>(
    "/portal/v1/buyer/keys/:id/revoke",
    {
      schema: {
        tags: ["portal"],
        summary: "Revoke a buyer agent key",
        description:
          "Immediately revokes an agent key so subsequent authorization requests fail with `401 key_revoked` (SPEC.md sections 5.2, 8.4, 8.8).",
        params: IdParamsSchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const k = facilitator.revokeAgentKey(request.params.id, new Date(), wallet.id);
      await facilitator.persistAgentKeyRevoke(k.id, k.revokedAt ?? new Date());
      return {
        id: k.id,
        status: k.status,
        revoked_at: k.revokedAt?.toISOString() ?? null,
      };
    },
  );

  app.get<{
    Querystring: Static<typeof BuyerPaymentsQuerySchema>;
  }>(
    "/portal/v1/buyer/payments",
    {
      schema: {
        tags: ["portal"],
        summary: "List buyer payments with filters and cursor pagination",
        description:
          "Lists payments for the authenticated buyer wallet filtered by key, seller, status, and date range (SPEC.md sections 5.2 and 11.4).",
        querystring: BuyerPaymentsQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      let items = facilitator.listBuyerPayments(wallet.id);

      if (request.query.key) {
        items = items.filter((p) => p.agentKeyId === request.query.key);
      }
      if (request.query.seller) {
        const q = request.query.seller.toLowerCase();
        items = items.filter((p) => p.sellerId.toLowerCase().includes(q));
      }
      if (request.query.status) {
        items = items.filter((p) => p.status === request.query.status);
      }
      if (request.query.from) {
        const fromMs = Date.parse(request.query.from);
        if (!Number.isNaN(fromMs)) {
          items = items.filter((p) => p.createdAt.getTime() >= fromMs);
        }
      }
      if (request.query.to) {
        const toMs = Date.parse(request.query.to);
        if (!Number.isNaN(toMs)) {
          items = items.filter((p) => p.createdAt.getTime() <= toMs);
        }
      }

      const paged = paginateByCursor(items, request.query.limit ?? 50, request.query.cursor);
      return {
        data: paged.data.map((p) => ({
          id: p.id,
          payment_id: p.id,
          status: p.status,
          amount: formatMoney(p.amountMicros),
          currency: "USD",
          method: p.method,
          url: p.url,
          seller_id: p.sellerId,
          agent_key_id: p.agentKeyId,
          key_name: p.keyName,
          challenge_id: p.challengeId,
          authorized_at: p.authorizedAt.toISOString(),
          captured_at: p.capturedAt ? p.capturedAt.toISOString() : null,
          released_at: p.releasedAt ? p.releasedAt.toISOString() : null,
          refunded_at: p.refundedAt ? p.refundedAt.toISOString() : null,
          receipt: p.receipt,
          created_at: p.createdAt.toISOString(),
        })),
        next_cursor: paged.next_cursor,
      };
    },
  );

  app.get<{
    Params: Static<typeof IdParamsSchema>;
  }>(
    "/portal/v1/buyer/payments/:id",
    {
      schema: {
        tags: ["portal"],
        summary: "Read a single buyer payment",
        description:
          "Returns detailed timeline and receipt for a single payment owned by the authenticated buyer (`404` if foreign, SPEC.md sections 5.2 and 8.4).",
        params: IdParamsSchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const p = facilitator.getBuyerPayment(wallet.id, request.params.id);
      return {
        id: p.id,
        payment_id: p.id,
        status: p.status,
        amount: formatMoney(p.amountMicros),
        currency: "USD",
        method: p.method,
        url: p.url,
        seller_id: p.sellerId,
        agent_key_id: p.agentKeyId,
        key_name: p.keyName,
        challenge_id: p.challengeId,
        authorized_at: p.authorizedAt.toISOString(),
        expires_at: p.expiresAt.toISOString(),
        captured_at: p.capturedAt ? p.capturedAt.toISOString() : null,
        released_at: p.releasedAt ? p.releasedAt.toISOString() : null,
        refunded_at: p.refundedAt ? p.refundedAt.toISOString() : null,
        receipt: p.receipt,
        created_at: p.createdAt.toISOString(),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Wallet Top-ups (/portal/v1/buyer/topups*)
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: Static<typeof CursorQuerySchema>;
  }>(
    "/portal/v1/buyer/topups",
    {
      schema: {
        tags: ["portal"],
        summary: "List buyer wallet top-ups",
        description:
          "Lists PayPal top-up orders for the authenticated buyer wallet with cursor pagination (SPEC.md sections 5.2, 7.1, 11.4).",
        querystring: CursorQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const topups = facilitator.listWalletTopups(wallet.id);
      const paged = paginateByCursor(topups, request.query.limit ?? 50, request.query.cursor);
      return {
        data: paged.data.map((t) => ({
          id: t.id,
          amount: formatMoney(t.amountMicros),
          status: t.status,
          paypal_order_id: t.paypalOrderId,
          paypal_capture_id: t.paypalCaptureId,
          created_at: t.createdAt.toISOString(),
        })),
        next_cursor: paged.next_cursor,
      };
    },
  );

  app.post<{
    Body: Static<typeof CreateTopupBodySchema>;
  }>(
    "/portal/v1/buyer/topups",
    {
      schema: {
        tags: ["portal"],
        summary: "Create a PayPal top-up order",
        description:
          "Validates top-up and max wallet balance limits, creates a `topups` record, and creates a PayPal Checkout Order v2 with `PayPal-Request-Id = top_<ULID>` (SPEC.md sections 5.2 and 7.1 step 1).",
        body: CreateTopupBodySchema,
      },
    },
    async (request, reply) => {
      const { account } = requireAuth(request);
      if (!account.isBuyer) {
        await facilitator.updateAccountProfile({ accountId: account.id, isBuyer: true });
      }
      const wallet = facilitator.getWalletForAccount(account.id);
      const topup = await facilitator.createTopupOrder({
        walletId: wallet.id,
        amountUsd: request.body.amount,
      });
      return reply.status(201).send({
        id: topup.id,
        order_id: topup.paypalOrderId,
        approve_url: topup.approveUrl,
        amount: formatMoney(topup.amountMicros),
        status: topup.status,
      });
    },
  );

  app.post<{
    Params: Static<typeof IdParamsSchema>;
  }>(
    "/portal/v1/buyer/topups/:id/capture",
    {
      schema: {
        tags: ["portal"],
        summary: "Capture an approved PayPal top-up order",
        description:
          "Captures the PayPal Checkout Order and credits the buyer wallet ONLY when PayPal confirms `COMPLETED` status (SPEC.md sections 5.2 and 7.1 steps 3-4).",
        params: IdParamsSchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const wallet = facilitator.getWalletForAccount(account.id);
      const topup = await facilitator.captureTopupOrder({
        walletId: wallet.id,
        topupId: request.params.id,
      });
      return {
        id: topup.id,
        order_id: topup.paypalOrderId,
        capture_id: topup.paypalCaptureId,
        amount: formatMoney(topup.amountMicros),
        status: topup.status,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Seller Routes (/portal/v1/seller/*)
  // ---------------------------------------------------------------------------

  app.get(
    "/portal/v1/seller/summary",
    {
      schema: {
        tags: ["portal"],
        summary: "Seller overview summary",
        description:
          "Returns pending, processing, and paid-out balances, 24h call count, 30d net revenue, top endpoints, and recent calls (SPEC.md sections 5.2 and 11.5).",
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      return facilitator.getSellerSummary(account.id);
    },
  );

  app.get<{
    Querystring: Static<typeof DaysQuerySchema>;
  }>(
    "/portal/v1/seller/revenue-series",
    {
      schema: {
        tags: ["portal"],
        summary: "Seller daily net revenue time-series",
        description:
          "Returns daily net revenue and call counts over the requested number of UTC days (default 30, SPEC.md sections 5.2 and 11.5).",
        querystring: DaysQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const series = facilitator.getSellerRevenueSeries(account.id, request.query.days ?? 30);
      return { data: series };
    },
  );

  app.get(
    "/portal/v1/seller/endpoints",
    {
      schema: {
        tags: ["portal"],
        summary: "List auto-discovered seller endpoints",
        description:
          "Lists endpoints discovered on capture along with 30-day call count and net revenue (SPEC.md sections 2.1 D7, 5.2, 11.5).",
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      return {
        data: facilitator.listSellerEndpointsWithStats(seller.id),
      };
    },
  );

  app.patch<{
    Params: Static<typeof IdParamsSchema>;
    Body: Static<typeof UpdateEndpointBodySchema>;
  }>(
    "/portal/v1/seller/endpoints/:id",
    {
      schema: {
        tags: ["portal"],
        summary: "Update seller endpoint metadata",
        description:
          "Updates `display_name`, `description`, or `status` for a seller endpoint (`404` if owned by another tenant, SPEC.md sections 5.2, 8.4, 11.5).",
        params: IdParamsSchema,
        body: UpdateEndpointBodySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      const ep = facilitator.updateSellerEndpoint(seller.id, request.params.id, {
        displayName: request.body.display_name,
        description: request.body.description,
        status: request.body.status,
      });
      return {
        id: ep.id,
        seller_id: ep.sellerId,
        method: ep.method,
        route: ep.route,
        display_name: ep.displayName,
        description: ep.description,
        last_price: formatMoney(ep.lastPriceMicros),
        status: ep.status,
      };
    },
  );

  app.get(
    "/portal/v1/seller/keys",
    {
      schema: {
        tags: ["portal"],
        summary: "List seller API keys",
        description:
          "Lists all seller API keys (`hgs_<env>_...`) belonging to the authenticated seller (SPEC.md sections 5.2 and 11.5).",
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      const keys = facilitator.listSellerKeys(seller.id);
      return {
        data: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          status: k.status,
          last_used_at: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          revoked_at: k.revokedAt ? k.revokedAt.toISOString() : null,
          created_at: k.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post<{
    Body: Static<typeof CreateSellerKeyBodySchema>;
  }>(
    "/portal/v1/seller/keys",
    {
      schema: {
        tags: ["portal"],
        summary: "Create a seller API key",
        description:
          "Issues a new `hgs_<env>_...` seller API key (max 2 active keys per seller) and returns the full secret key once (SPEC.md sections 5.2, 6.1, 11.5).",
        body: CreateSellerKeyBodySchema,
      },
    },
    async (request, reply) => {
      const { account } = requireAuth(request);
      if (!account.isSeller) {
        await facilitator.updateAccountProfile({ accountId: account.id, isSeller: true });
      }
      const seller = facilitator.getSellerForAccount(account.id);
      const { record, fullKey } = facilitator.createSellerKey({
        sellerId: seller.id,
        name: request.body.name,
      });
      await facilitator.persistSellerKey(record);
      return reply.status(201).send({
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        key: fullKey,
        status: record.status,
        created_at: record.createdAt.toISOString(),
      });
    },
  );

  app.post<{
    Params: Static<typeof IdParamsSchema>;
  }>(
    "/portal/v1/seller/keys/:id/revoke",
    {
      schema: {
        tags: ["portal"],
        summary: "Revoke a seller API key",
        description:
          "Immediately revokes a seller API key (`404` if owned by another tenant, SPEC.md sections 5.2 and 8.4).",
        params: IdParamsSchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      const k = facilitator.revokeSellerKey(request.params.id, new Date(), seller.id);
      await facilitator.persistSellerKeyRevoke(k.id, k.revokedAt ?? new Date());
      return {
        id: k.id,
        status: k.status,
        revoked_at: k.revokedAt?.toISOString() ?? null,
      };
    },
  );

  app.get<{
    Querystring: Static<typeof SellerCallsQuerySchema>;
  }>(
    "/portal/v1/seller/calls",
    {
      schema: {
        tags: ["portal"],
        summary: "List seller calls with pseudonymous agent_ref",
        description:
          "Lists calls (payments) to the authenticated seller's endpoints with pseudonymous `agent_ref`, gross amount, platform fee, and seller net (SPEC.md sections 5.2, 8.4, 11.5).",
        querystring: SellerCallsQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      let calls = facilitator.listSellerCalls(seller.id);

      if (request.query.endpoint) {
        calls = calls.filter(
          (c) => c.endpointId === request.query.endpoint || c.route === request.query.endpoint,
        );
      }
      if (request.query.status) {
        calls = calls.filter((c) => c.status === request.query.status);
      }
      if (request.query.from) {
        const fromMs = Date.parse(request.query.from);
        if (!Number.isNaN(fromMs)) {
          calls = calls.filter((c) => c.createdAt.getTime() >= fromMs);
        }
      }
      if (request.query.to) {
        const toMs = Date.parse(request.query.to);
        if (!Number.isNaN(toMs)) {
          calls = calls.filter((c) => c.createdAt.getTime() <= toMs);
        }
      }

      const paged = paginateByCursor(calls, request.query.limit ?? 50, request.query.cursor);
      return {
        data: paged.data.map((c) => ({
          id: c.id,
          payment_id: c.id,
          status: c.status,
          amount: formatMoney(c.amountMicros),
          fee: formatMoney(c.feeMicros),
          seller_net: formatMoney(c.amountMicros - c.feeMicros),
          method: c.method,
          route: c.route,
          url: c.url,
          agent_ref: c.agentRef,
          receipt: c.receipt,
          captured_at: c.capturedAt ? c.capturedAt.toISOString() : null,
          refunded_at: c.refundedAt ? c.refundedAt.toISOString() : null,
          created_at: c.createdAt.toISOString(),
        })),
        next_cursor: paged.next_cursor,
      };
    },
  );

  app.get<{
    Querystring: Static<typeof CursorQuerySchema>;
  }>(
    "/portal/v1/seller/payouts",
    {
      schema: {
        tags: ["portal"],
        summary: "List seller payouts",
        description:
          "Lists payouts for the authenticated seller in reverse chronological order (SPEC.md sections 5.2, 7.2, 11.5).",
        querystring: CursorQuerySchema,
      },
    },
    async (request) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      const payouts = facilitator.listSellerPayouts(seller.id);
      const paged = paginateByCursor(payouts, request.query.limit ?? 50, request.query.cursor);
      return {
        data: paged.data.map((p) => ({
          id: p.id,
          amount: formatMoney(p.amountMicros),
          batch_ref: p.batchRef,
          paypal_batch_id: p.paypalBatchId,
          paypal_item_id: p.paypalItemId,
          paypal_fee: p.paypalFeeMicros !== null ? formatMoney(p.paypalFeeMicros) : null,
          status: p.status,
          mode: p.mode,
          failure_reason: p.failureReason,
          requested_by: p.requestedBy,
          created_at: p.createdAt.toISOString(),
        })),
        next_cursor: paged.next_cursor,
      };
    },
  );

  app.post(
    "/portal/v1/seller/payouts",
    {
      schema: {
        tags: ["portal"],
        summary: "Request an on-demand seller payout",
        description:
          "Initiates an on-demand payout to the seller's PayPal `payer_id` (max 1 request per hour, minimum $1.00 pending balance, floored to whole cents, SPEC.md sections 5.2 and 7.2).",
      },
    },
    async (request, reply) => {
      const { account } = requireAuth(request);
      const seller = facilitator.getSellerForAccount(account.id);
      const payout = await facilitator.requestSellerPayout({
        sellerId: seller.id,
        requestedBy: "seller",
      });
      return reply.status(201).send({
        id: payout.id,
        amount: formatMoney(payout.amountMicros),
        batch_ref: payout.batchRef,
        paypal_batch_id: payout.paypalBatchId,
        status: payout.status,
        mode: payout.mode,
        created_at: payout.createdAt.toISOString(),
      });
    },
  );

  app.post(
    "/portal/v1/seller/test-key",
    {
      schema: {
        tags: ["portal"],
        summary: "Issue a sandbox test agent key for seller setup",
        description:
          "Issues a sandbox-only agent key restricted to this seller (`allowed_sellers`) and capped at $0.50/day so the seller can test their first paid call without funding a separate buyer wallet (SPEC.md sections 5.2 and 11.5 step 4).",
      },
    },
    async (request, reply) => {
      const { account } = requireAuth(request);
      const { record, fullKey } = facilitator.issueSellerTestKey(account.id);
      return reply.status(201).send({
        id: record.id,
        key: fullKey,
        per_call_max: formatMoney(record.perCallMaxMicros),
        daily_max: formatMoney(record.dailyMaxMicros),
        allowed_sellers: record.allowedSellers,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // PayPal Webhook Receiver (POST /webhooks/paypal, SPEC.md section 8.5)
  // ---------------------------------------------------------------------------

  await app.register(async (webhookScope) => {
    // Capture exact raw request bytes on this route only so PayPal signature verification never fails due to JSON re-serialization (SPEC 8.5)
    webhookScope.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => {
        done(null, body);
      },
    );

    webhookScope.post(
      "/webhooks/paypal",
      {
        schema: {
          tags: ["webhooks"],
          summary: "Receive and verify PayPal webhook notifications",
          description:
            "Verifies the PayPal webhook signature using the raw request body bytes, deduplicates by `paypal_event_id`, and reconciles top-up captures and seller payout items by re-fetching from PayPal (SPEC.md sections 5.2, 7.1, 7.2, 8.5).",
          response: {
            200: Type.Object({
              verified: Type.Literal(true),
              duplicate: Type.Boolean(),
              event_id: Type.String(),
              event_type: Type.String(),
            }),
            401: ProblemDetailsSchema,
            422: ProblemDetailsSchema,
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(request.headers)) {
          if (typeof v === "string") {
            headers[k.toLowerCase()] = v;
          }
        }

        const result = await facilitator.handlePayPalWebhook({
          headers,
          rawBody,
        });

        return reply.status(200).send({
          verified: result.verified,
          duplicate: result.duplicate,
          event_id: result.eventId,
          event_type: result.eventType,
        });
      },
    );
  });
}
