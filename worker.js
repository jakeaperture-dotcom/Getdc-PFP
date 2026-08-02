const API_PATH = "/api/pfps/discord";
const AVATAR_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_EXTENSIONS = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const jsonResponse = (status, data, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
      ...extraHeaders,
    },
  });

const apiError = (status, code, message) =>
  Object.assign(new Error(message), { status, code });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/index.html") {
      return new Response(null, {
        status: 308,
        headers: { ...SECURITY_HEADERS, Location: "/" },
      });
    }

    if (url.pathname === "/healthz") {
      return jsonResponse(200, { status: "ok" });
    }

    if (url.pathname !== API_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse(405, {
          code: "METHOD_NOT_ALLOWED",
          error: "Method not allowed.",
        });
      }

      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
        headers.set(name, value);
      });
      headers.set("Cache-Control", "public, max-age=0, must-revalidate");

      return new Response(asset.body, {
        status: asset.status,
        statusText: asset.statusText,
        headers,
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, {
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed.",
      });
    }

    try {
      const clientIp = request.headers.get("CF-Connecting-IP") || "local";
      const { success } = await env.API_RATE_LIMITER.limit({ key: clientIp });

      if (!success) {
        return jsonResponse(
          429,
          {
            code: "RATE_LIMITED",
            error: "Too many requests. Try again shortly.",
          },
          { "Retry-After": "60" },
        );
      }

      const userId = url.searchParams.get("userId")?.trim() || "";

      if (!/^\d{17,20}$/.test(userId)) {
        return jsonResponse(400, {
          code: "INVALID_USER_ID",
          error: "Enter a valid 17–20 digit Discord user ID.",
        });
      }

      const upstreamUrl = new URL(
        "https://skit-utils.vercel.app/api/pfps/discord",
      );
      upstreamUrl.searchParams.set("userId", userId);

      const upstream = await fetch(upstreamUrl, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });

      if (upstream.status === 400 || upstream.status === 404) {
        throw apiError(404, "USER_NOT_FOUND", "Discord user not found.");
      }

      if (upstream.status === 429) {
        throw apiError(
          503,
          "UPSTREAM_LIMITED",
          "The lookup service is busy. Try again shortly.",
        );
      }

      if (!upstream.ok) {
        throw apiError(
          502,
          "UPSTREAM_ERROR",
          "The lookup service is unavailable.",
        );
      }

      const user = await upstream.json();

      if (typeof user?.username !== "string" || !user.username.trim()) {
        throw apiError(
          502,
          "INVALID_UPSTREAM_RESPONSE",
          "That profile does not have a usable avatar.",
        );
      }

      let avatarUrl;

      try {
        avatarUrl = new URL(user.avatarUrl);
      } catch {
        throw apiError(
          502,
          "INVALID_UPSTREAM_RESPONSE",
          "That profile does not have a usable avatar.",
        );
      }

      if (
        avatarUrl.protocol !== "https:" ||
        !AVATAR_HOSTS.has(avatarUrl.hostname)
      ) {
        throw apiError(
          502,
          "INVALID_UPSTREAM_RESPONSE",
          "That profile does not have a usable avatar.",
        );
      }

      const downloadRequested = url.searchParams.get("download") === "1";
      avatarUrl.searchParams.set("size", downloadRequested ? "4096" : "512");

      if (!downloadRequested) {
        return jsonResponse(200, {
          username: user.username,
          avatarUrl: avatarUrl.href,
        });
      }

      const avatarResponse = await fetch(avatarUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });

      if (!avatarResponse.ok) {
        throw apiError(
          502,
          "AVATAR_DOWNLOAD_FAILED",
          "The avatar image could not be downloaded.",
        );
      }

      const imageType = (avatarResponse.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const contentLength = Number(
        avatarResponse.headers.get("content-length") || 0,
      );

      if (!IMAGE_EXTENSIONS.has(imageType) || contentLength > MAX_AVATAR_BYTES) {
        throw apiError(
          502,
          "UNSUPPORTED_AVATAR",
          "The avatar image is too large or unsupported.",
        );
      }

      const avatarBytes = await avatarResponse.arrayBuffer();

      if (!avatarBytes.byteLength || avatarBytes.byteLength > MAX_AVATAR_BYTES) {
        throw apiError(
          502,
          "UNSUPPORTED_AVATAR",
          "The avatar image is too large or unsupported.",
        );
      }

      const safeName =
        user.username.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) ||
        "discord";

      return new Response(avatarBytes, {
        headers: {
          ...SECURITY_HEADERS,
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${safeName}-avatar.${IMAGE_EXTENSIONS.get(imageType)}"`,
          "Content-Length": String(avatarBytes.byteLength),
          "Content-Type": imageType,
          "X-Robots-Tag": "noindex",
        },
      });
    } catch (error) {
      console.error("Avatar lookup failed", error?.name, error?.message);
      const timedOut = error?.name === "TimeoutError";
      const status = Number.isInteger(error?.status)
        ? error.status
        : timedOut
          ? 504
          : 502;

      return jsonResponse(status, {
        code:
          error?.code || (timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR"),
        error: error?.status
          ? error.message
          : timedOut
            ? "The lookup service timed out. Try again."
            : "The lookup service is unavailable.",
      });
    }
  },
};
