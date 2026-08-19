const API_PATH = "/api/pfps/discord";
const HOST_POSTS_PATH = "/api/host/posts";
const HOST_LIVE_PATH = "/api/host/live";
const HOST_FILES_PREFIX = "/api/host/files/";
const FILE_OBJECT_PREFIX = "files/";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;
const MAX_AUTHOR_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 1200;
const SAFE_PREVIEW_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
]);
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

const hostApiError = (status, code, message) =>
  jsonResponse(status, { code, error: message });

const postFromMetadata = (metadata = {}) => {
  const hasFile = metadata.hasFile === "1";
  const id = metadata.id || "";
  const fileType = metadata.fileType || "application/octet-stream";

  return {
    id,
    author: metadata.author || "Anonymous",
    message: metadata.message || "",
    createdAt: metadata.createdAt || new Date(0).toISOString(),
    file: hasFile
      ? {
          name: metadata.fileName || "download",
          type: fileType,
          size: Number(metadata.fileSize) || 0,
          downloadUrl: `${HOST_FILES_PREFIX}${id}?download=1`,
          previewUrl: SAFE_PREVIEW_TYPES.has(fileType)
            ? `${HOST_FILES_PREFIX}${id}?preview=1`
            : null,
        }
      : null,
  };
};

const getPostHub = (env) => {
  const hubId = env.POST_HUB.idFromName("classroom-wall");
  return env.POST_HUB.get(hubId);
};

const listHostPosts = async (env) => {
  const response = await getPostHub(env).fetch("https://host.internal/posts", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Post hub unavailable");
  const posts = await response.json();
  return jsonResponse(200, { posts: posts.map(postFromMetadata) });
};

const createHostPost = async (request, env) => {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return hostApiError(
      413,
      "UPLOAD_TOO_LARGE",
      "The complete post must be 20 MB or smaller.",
    );
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || "local";
  const { success } = await env.API_RATE_LIMITER.limit({
    key: `host-post:${clientIp}`,
  });

  if (!success) {
    return jsonResponse(
      429,
      { code: "RATE_LIMITED", error: "Too many posts. Try again shortly." },
      { "Retry-After": "60" },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return hostApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Posts must use multipart form data.",
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return hostApiError(400, "INVALID_FORM", "The post could not be read.");
  }

  const authorValue = formData.get("author");
  const messageValue = formData.get("message");
  const fileValue = formData.get("file");
  const author =
    (typeof authorValue === "string" ? authorValue.trim() : "").slice(
      0,
      MAX_AUTHOR_LENGTH,
    ) || "Anonymous";
  const message =
    typeof messageValue === "string" ? messageValue.trim() : "";
  const hasFile =
    fileValue &&
    typeof fileValue !== "string" &&
    typeof fileValue.arrayBuffer === "function" &&
    fileValue.size > 0;

  if (message.length > MAX_MESSAGE_LENGTH) {
    return hostApiError(
      400,
      "MESSAGE_TOO_LONG",
      `Keep the note under ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }

  if (!message && !hasFile) {
    return hostApiError(
      400,
      "EMPTY_POST",
      "Add a note or choose a file before posting.",
    );
  }

  if (hasFile && fileValue.size > MAX_UPLOAD_BYTES) {
    return hostApiError(
      413,
      "UPLOAD_TOO_LARGE",
      "Files must be 20 MB or smaller.",
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const originalName = hasFile
    ? (fileValue.name || "download").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) ||
      "download"
    : "";
  const suppliedFileType = hasFile ? fileValue.type.toLowerCase() : "";
  const fileType = hasFile
    ? /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(
        suppliedFileType,
      )
      ? suppliedFileType.slice(0, 120)
      : "application/octet-stream"
    : "";
  const fileKey = `${FILE_OBJECT_PREFIX}${id}`;
  let fileWasStored = false;

  try {
    if (hasFile) {
      await env.HOST_FILES.put(fileKey, fileValue.stream(), {
        httpMetadata: { contentType: fileType },
        customMetadata: { originalName },
      });
      fileWasStored = true;
    }

    const metadata = {
      id,
      author,
      message,
      createdAt,
      hasFile: hasFile ? "1" : "0",
      fileName: originalName,
      fileType,
      fileSize: hasFile ? String(fileValue.size) : "0",
    };

    const stored = await getPostHub(env).fetch("https://host.internal/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
    if (!stored.ok) throw new Error("Post metadata could not be stored");

    return jsonResponse(201, { post: postFromMetadata(metadata) });
  } catch (error) {
    if (fileWasStored) {
      await env.HOST_FILES.delete(fileKey).catch(() => {});
    }
    console.error("Host post storage failed", error?.message);
    return hostApiError(
      503,
      "STORAGE_UNAVAILABLE",
      "The post could not be saved. Try again.",
    );
  }
};

const contentDisposition = (mode, fileName) => {
  const asciiName =
    fileName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .slice(0, 140) || "download";
  return `${mode}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const serveHostFile = async (request, env, url) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return hostApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  }

  const id = url.pathname.slice(HOST_FILES_PREFIX.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return hostApiError(404, "FILE_NOT_FOUND", "File not found.");
  }

  const object = await env.HOST_FILES.get(`${FILE_OBJECT_PREFIX}${id}`);
  if (!object) {
    return hostApiError(404, "FILE_NOT_FOUND", "File not found.");
  }

  const headers = new Headers(SECURITY_HEADERS);
  object.writeHttpMetadata(headers);
  const fileType = headers.get("Content-Type") || "application/octet-stream";
  const wantsPreview =
    url.searchParams.get("preview") === "1" && SAFE_PREVIEW_TYPES.has(fileType);
  const fileName = object.customMetadata?.originalName || "download";

  headers.set("Cache-Control", "private, no-store");
  headers.set(
    "Content-Disposition",
    contentDisposition(wantsPreview ? "inline" : "attachment", fileName),
  );
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
};

export class PostHub {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/posts" && request.method === "GET") {
      const posts = await this.state.storage.list({
        prefix: "posts/",
        limit: 50,
      });
      return new Response(JSON.stringify([...posts.values()]), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (url.pathname === "/posts" && request.method === "POST") {
      const post = await request.json();
      const reverseTimestamp = String(
        9_999_999_999_999 - new Date(post.createdAt).getTime(),
      ).padStart(13, "0");
      await this.state.storage.put(
        `posts/${reverseTimestamp}-${post.id}`,
        post,
      );

      const message = JSON.stringify({
        type: "post.created",
        postId: post.id,
      });
      this.state.getWebSockets().forEach((socket) => {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "Broadcast failed");
        }
      });
      return new Response(null, { status: 201 });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }
}

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

    if (url.pathname === HOST_POSTS_PATH) {
      if (request.method === "GET") {
        try {
          return await listHostPosts(env);
        } catch (error) {
          console.error("Host feed failed", error?.message);
          return hostApiError(
            503,
            "FEED_UNAVAILABLE",
            "The wall could not be loaded. Try again.",
          );
        }
      }
      if (request.method === "POST") {
        return createHostPost(request, env);
      }
      return hostApiError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    }

    if (url.pathname === HOST_LIVE_PATH) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return hostApiError(
          426,
          "UPGRADE_REQUIRED",
          "A WebSocket connection is required.",
        );
      }
      return getPostHub(env).fetch(request);
    }

    if (url.pathname.startsWith(HOST_FILES_PREFIX)) {
      return serveHostFile(request, env, url);
    }

    if (url.pathname === "/host" || url.pathname === "/host/index.html") {
      return new Response(null, {
        status: 308,
        headers: {
          ...SECURITY_HEADERS,
          Location: "/host/",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    if (url.pathname === "/host/") {
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
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self' wss: ws:; font-src 'self'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
      headers.set("X-Robots-Tag", "noindex, nofollow");

      return new Response(asset.body, {
        status: asset.status,
        statusText: asset.statusText,
        headers,
      });
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
