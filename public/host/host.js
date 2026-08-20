const MAX_FILE_BYTES = 20 * 1024 * 1024;
const POSTS_API = "/api/host/posts";
const KNOWLEDGE_API = "/api/host/knowledge";
const MAX_KNOWLEDGE_BYTES = 10 * 1024 * 1024;
const LOCAL_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const chatStream = document.querySelector("#chat-stream");
const postGrid = document.querySelector("#post-grid");
const feedStatus = document.querySelector("#feed-status");
const liveStatus = document.querySelector("#live-status");
const typingStatus = document.querySelector("#typing-status");
const postForm = document.querySelector("#post-form");
const authorInput = document.querySelector("#author");
const messageInput = document.querySelector("#message");
const fileInput = document.querySelector("#file");
const selectedFile = document.querySelector("#selected-file");
const selectedFilePreview = document.querySelector("#selected-file-preview");
const selectedFileImage = document.querySelector("#selected-file-image");
const selectedFileType = document.querySelector("#selected-file-type");
const selectedFileName = document.querySelector("#selected-file-name");
const selectedFileSize = document.querySelector("#selected-file-size");
const removeFileButton = document.querySelector("#remove-file");
const formError = document.querySelector("#form-error");
const replyTray = document.querySelector("#reply-tray");
const replyAuthor = document.querySelector("#reply-author");
const replyMessage = document.querySelector("#reply-message");
const cancelReplyButton = document.querySelector("#cancel-reply");
const postButton = document.querySelector("#post-button");
const imageDialog = document.querySelector("#image-dialog");
const dialogImage = document.querySelector("#dialog-image");
const dialogDownload = document.querySelector("#dialog-download");
const closeDialogButton = document.querySelector("#close-dialog");
const settingsButton = document.querySelector("#settings-button");
const compactWindowButton = document.querySelector("#compact-window-button");
const settingsDialog = document.querySelector("#settings-dialog");
const closeSettingsButton = document.querySelector("#close-settings");
const fridayAdminKey = document.querySelector("#friday-admin-key");
const knowledgeFileInput = document.querySelector("#knowledge-file");
const knowledgeFileName = document.querySelector("#knowledge-file-name");
const indexDocumentButton = document.querySelector("#index-document");
const knowledgeStatus = document.querySelector("#knowledge-status");
const knowledgeList = document.querySelector("#knowledge-list");
const messageMenu = document.querySelector("#message-menu");
const replyMessageAction = document.querySelector("#reply-message-action");
const deleteMessageAction = document.querySelector("#delete-message-action");

let posts = [];
let pendingFile = null;
let socket;
let reconnectTimer;
let reconnectAttempts = 0;
let isLoadingPosts = false;
let errorTimer;
let selectedPreviewUrl;
let knowledgeFile = null;
let knowledgeTimer;
let replyingTo = null;
let menuPost = null;
let longPressTimer;
let lastTypingSentAt = 0;
let typingStopTimer;
const remoteTypers = new Map();
const typingId = crypto.randomUUID();

const createDeviceToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getDeviceToken = () => {
  try {
    const stored = localStorage.getItem("class-wall-device");
    if (/^[a-f0-9]{64}$/i.test(stored || "")) return stored;
    const token = createDeviceToken();
    localStorage.setItem("class-wall-device", token);
    return token;
  } catch {
    return createDeviceToken();
  }
};

const deviceToken = getDeviceToken();

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
};

const fileExtension = (name) => {
  const extension = name.includes(".") ? name.split(".").pop() : "file";
  return extension.slice(0, 5).toUpperCase();
};

const relativeTime = (dateValue) => {
  const timestamp = new Date(dateValue).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return dateTimeFormatter.format(new Date(timestamp));
};

const isNearBottom = (threshold = 120) =>
  chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight <
  threshold;

const scrollToBottom = (behavior = "auto") => {
  chatStream.scrollTo({ top: chatStream.scrollHeight, behavior });
};

const showFeedStatus = (message, { loading = false, empty = false } = {}) => {
  const label = document.createElement("span");
  label.textContent = message;
  feedStatus.replaceChildren();
  feedStatus.classList.toggle("is-empty", empty);
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    feedStatus.append(spinner);
  }
  feedStatus.append(label);
  feedStatus.hidden = false;
};

const showFormError = (message) => {
  window.clearTimeout(errorTimer);
  formError.textContent = message;
  formError.hidden = false;
  errorTimer = window.setTimeout(() => {
    formError.hidden = true;
  }, 4500);
};

const clearFormError = () => {
  window.clearTimeout(errorTimer);
  formError.textContent = "";
  formError.hidden = true;
};

const resizeMessageInput = () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 104)}px`;
};

const setSelectedFile = (file) => {
  clearFormError();
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = undefined;
  pendingFile = file || null;
  selectedFilePreview.hidden = true;
  selectedFileImage.removeAttribute("src");
  selectedFileType.hidden = false;

  if (!file) {
    fileInput.value = "";
    selectedFile.hidden = true;
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    pendingFile = null;
    fileInput.value = "";
    selectedFile.hidden = true;
    showFormError("Maximum file size is 20 MB.");
    return;
  }

  selectedFileType.textContent = fileExtension(file.name);
  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = formatBytes(file.size);
  if (LOCAL_IMAGE_TYPES.has(file.type.toLowerCase())) {
    selectedPreviewUrl = URL.createObjectURL(file);
    selectedFileImage.src = selectedPreviewUrl;
    selectedFileImage.alt = `Preview of ${file.name}`;
    selectedFilePreview.hidden = false;
    selectedFileType.hidden = true;
  }
  selectedFile.hidden = false;
};

const createIcon = (pathData) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  pathData.forEach((data) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
};

const createFileRow = (post) => {
  const row = document.createElement("div");
  const type = document.createElement("span");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const size = document.createElement("small");
  const actions = document.createElement("span");

  row.className = "message-file";
  type.className = "file-type";
  type.textContent = fileExtension(post.file.name);
  copy.className = "file-copy";
  name.textContent = post.file.name;
  size.textContent = formatBytes(post.file.size);
  copy.append(name, size);
  actions.className = "file-actions";

  if (post.file.previewUrl) {
    const isImage = post.file.type.startsWith("image/");
    const viewAction = document.createElement(isImage ? "button" : "a");
    viewAction.className = "file-action";
    viewAction.setAttribute("aria-label", `View ${post.file.name}`);
    viewAction.setAttribute("title", "View");
    viewAction.append(
      createIcon([
        "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z",
        "M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
      ]),
    );
    if (isImage) {
      viewAction.type = "button";
      viewAction.addEventListener("click", () => openImage(post));
    } else {
      viewAction.href = post.file.previewUrl;
      viewAction.target = "_blank";
      viewAction.rel = "noopener noreferrer";
    }
    actions.append(viewAction);
  }

  const downloadAction = document.createElement("a");
  downloadAction.className = "file-action";
  downloadAction.href = post.file.downloadUrl;
  downloadAction.setAttribute("download", post.file.name);
  downloadAction.setAttribute("aria-label", `Download ${post.file.name}`);
  downloadAction.setAttribute("title", "Download");
  downloadAction.append(
    createIcon(["M12 4v11m0 0-4-4m4 4 4-4M5 20h14"]),
  );
  actions.append(downloadAction);
  row.append(type, copy, actions);
  return row;
};

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();
  if (!copied) throw new Error("Copy failed");
};

const createCodeBlock = (code) => {
  const block = document.createElement("pre");
  const content = document.createElement("code");
  block.className = "message-code";
  block.tabIndex = 0;
  block.title = "Copy";
  block.setAttribute("aria-label", "Copy code");
  content.textContent = code.replace(/^\n|\n$/g, "");
  block.append(content);

  const copy = async () => {
    try {
      await copyText(content.textContent);
      block.classList.add("is-copied");
      block.title = "Copied";
      window.setTimeout(() => {
        block.classList.remove("is-copied");
        block.title = "Copy";
      }, 1200);
    } catch {
      showFormError("Could not copy code.");
    }
  };
  block.addEventListener("click", copy);
  block.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copy();
    }
  });
  return block;
};

const appendMessageContent = (bubble, value) => {
  const fencePattern = /```[^\n`]*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = fencePattern.exec(value))) {
    const plain = value.slice(cursor, match.index).trim();
    if (plain) {
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = plain;
      bubble.append(text);
    }
    bubble.append(createCodeBlock(match[1]));
    cursor = match.index + match[0].length;
  }

  const trailing = value.slice(cursor).trim();
  if (trailing || !bubble.childElementCount) {
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = trailing || value;
    bubble.append(text);
  }
};

const openImage = (post) => {
  dialogImage.src = post.file.previewUrl;
  dialogImage.alt = `${post.file.name}, shared by ${post.author}`;
  dialogDownload.href = post.file.downloadUrl;
  dialogDownload.setAttribute("download", post.file.name);
  imageDialog.showModal();
};

const openSelectedImage = () => {
  if (!selectedPreviewUrl || !pendingFile) return;
  dialogImage.src = selectedPreviewUrl;
  dialogImage.alt = `Preview of ${pendingFile.name}`;
  dialogDownload.href = selectedPreviewUrl;
  dialogDownload.setAttribute("download", pendingFile.name);
  imageDialog.showModal();
};

const closeMessageMenu = () => {
  messageMenu.hidden = true;
  menuPost = null;
};

const setReply = (post) => {
  replyingTo = post;
  replyAuthor.textContent = post.author;
  replyMessage.textContent =
    post.message?.replace(/\s+/g, " ").trim() || post.file?.name || "Attachment";
  replyTray.hidden = false;
  closeMessageMenu();
  messageInput.focus();
};

const clearReply = () => {
  replyingTo = null;
  replyTray.hidden = true;
  replyAuthor.textContent = "";
  replyMessage.textContent = "";
};

const focusMessage = (postId) => {
  const target = document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("is-highlighted");
  window.requestAnimationFrame(() => target.classList.add("is-highlighted"));
  window.setTimeout(() => target.classList.remove("is-highlighted"), 1400);
};

const createReplyQuote = (reply) => {
  const quote = document.createElement("button");
  const author = document.createElement("strong");
  const text = document.createElement("span");
  quote.className = "message-reply";
  quote.type = "button";
  quote.title = "Go to message";
  author.textContent = reply.author;
  text.textContent = reply.message;
  quote.append(author, text);
  quote.addEventListener("click", () => focusMessage(reply.id));
  return quote;
};

const openMessageMenu = (post, clientX, clientY) => {
  menuPost = post;
  deleteMessageAction.hidden = !(
    post.canDelete || fridayAdminKey.value.trim()
  );
  messageMenu.hidden = false;
  messageMenu.style.left = "0";
  messageMenu.style.top = "0";
  const bounds = messageMenu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - bounds.width - 8);
  const top = Math.min(clientY, window.innerHeight - bounds.height - 8);
  messageMenu.style.left = `${Math.max(8, left)}px`;
  messageMenu.style.top = `${Math.max(8, top)}px`;
  replyMessageAction.focus({ preventScroll: true });
};

const createMessage = (post) => {
  const message = document.createElement("article");
  const meta = document.createElement("div");
  const author = document.createElement("strong");
  const time = document.createElement("time");
  const bubble = document.createElement("div");
  const isOwn = !post.bot && post.canDelete;

  message.className = `message${isOwn ? " is-own" : ""}${post.bot ? " is-bot" : ""}`;
  message.dataset.postId = post.id;
  meta.className = "message-meta";
  author.textContent = post.author;
  time.dateTime = post.createdAt;
  time.title = new Date(post.createdAt).toLocaleString();
  time.dataset.relativeTime = post.createdAt;
  time.textContent = relativeTime(post.createdAt);
  meta.append(author, time);
  bubble.className = "message-bubble";

  if (post.reply) bubble.append(createReplyQuote(post.reply));

  if (post.message) {
    appendMessageContent(bubble, post.message);
  }

  if (post.file?.previewUrl && post.file.type.startsWith("image/")) {
    const preview = document.createElement("button");
    const image = document.createElement("img");
    preview.className = "message-image";
    preview.type = "button";
    preview.setAttribute("aria-label", `Open ${post.file.name}`);
    image.src = post.file.previewUrl;
    image.alt = `${post.file.name}, shared by ${post.author}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (isNearBottom(240)) scrollToBottom();
    });
    preview.append(image);
    preview.addEventListener("click", () => openImage(post));
    bubble.append(preview);
  }

  if (post.file) bubble.append(createFileRow(post));
  message.append(meta, bubble);
  message.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openMessageMenu(post, event.clientX, event.clientY);
  });
  message.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
      openMessageMenu(post, event.clientX, event.clientY);
    }, 550);
  });
  ["pointerup", "pointercancel", "pointermove"].forEach((eventName) => {
    message.addEventListener(eventName, () => window.clearTimeout(longPressTimer));
  });
  return message;
};

const renderPosts = ({ scroll = false } = {}) => {
  const chronologicalPosts = [...posts].reverse();
  postGrid.replaceChildren(...chronologicalPosts.map(createMessage));
  feedStatus.hidden = Boolean(posts.length);

  if (!posts.length) {
    showFeedStatus("No messages yet", { empty: true });
  }

  if (scroll) {
    window.requestAnimationFrame(() => scrollToBottom());
  }
};

const loadPosts = async ({ silent = false } = {}) => {
  if (isLoadingPosts) return;
  isLoadingPosts = true;
  const hadPosts = posts.length > 0;
  const previousNewestId = posts[0]?.id;
  const wasNearBottom = isNearBottom();

  if (!silent && !hadPosts) showFeedStatus("Loading", { loading: true });

  try {
    const response = await fetch(POSTS_API, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Host-Device": deviceToken,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.posts)) {
      throw new Error(data.error || "Could not load messages.");
    }

    posts = data.posts;
    const hasNewMessage = Boolean(posts[0]?.id && posts[0].id !== previousNewestId);
    renderPosts({ scroll: !hadPosts || (hasNewMessage && wasNearBottom) });
  } catch (error) {
    if (!posts.length) {
      showFeedStatus(
        error instanceof Error ? error.message : "Could not load messages.",
        { empty: true },
      );
    }
  } finally {
    isLoadingPosts = false;
  }
};

const setLiveState = (state, label) => {
  liveStatus.dataset.state = state;
  liveStatus.title = label;
  liveStatus.lastElementChild.textContent = label;
};

const renderTypingStatus = () => {
  const now = Date.now();
  for (const [id, typer] of remoteTypers) {
    if (typer.expiresAt <= now) remoteTypers.delete(id);
  }
  const names = [...new Set([...remoteTypers.values()].map((typer) => typer.name))];
  if (!names.length) {
    typingStatus.hidden = true;
    typingStatus.textContent = "";
    return;
  }
  typingStatus.textContent =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : "Several people are typing…";
  typingStatus.hidden = false;
};

const receiveTyping = (update) => {
  if (!update.id || !update.name || update.id === typingId) return;
  if (update.active) {
    remoteTypers.set(update.id, {
      name: update.name,
      expiresAt: Date.now() + 4200,
    });
  } else {
    remoteTypers.delete(update.id);
  }
  renderTypingStatus();
};

const sendTyping = (active) => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const name = authorInput.value.trim();
  if (active && !name) return;
  socket.send(JSON.stringify({ type: "typing", id: typingId, name, active }));
  if (active) lastTypingSentAt = Date.now();
};

const updateOwnTyping = () => {
  window.clearTimeout(typingStopTimer);
  const active = Boolean(messageInput.value.trim() && authorInput.value.trim());
  if (active && Date.now() - lastTypingSentAt > 1100) sendTyping(true);
  if (active) {
    typingStopTimer = window.setTimeout(() => sendTyping(false), 1800);
  } else {
    sendTyping(false);
  }
};

const connectLiveUpdates = () => {
  window.clearTimeout(reconnectTimer);
  socket?.close();

  const socketUrl = new URL("/api/host/live", window.location.href);
  socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(socketUrl);
  setLiveState("connecting", "Connecting");

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setLiveState("live", "Live");
    updateOwnTyping();
  });

  socket.addEventListener("message", (event) => {
    if (event.data === "pong") return;
    try {
      const update = JSON.parse(event.data);
      if (update.type === "post.created") loadPosts({ silent: true });
      if (update.type === "post.deleted") {
        posts = posts.filter((post) => post.id !== update.postId);
        if (replyingTo?.id === update.postId) clearReply();
        renderPosts();
      }
      if (update.type === "typing") receiveTyping(update);
    } catch {
      // Ignore messages that are not wall events.
    }
  });

  socket.addEventListener("close", () => {
    setLiveState("offline", "Reconnecting");
    remoteTypers.clear();
    renderTypingStatus();
    reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempts);
    reconnectTimer = window.setTimeout(connectLiveUpdates, delay);
  });

  socket.addEventListener("error", () => socket.close());
};

messageInput.addEventListener("input", () => {
  clearFormError();
  resizeMessageInput();
  updateOwnTyping();
});

const looksLikeEditorCode = (html, text) => {
  if (!html || !text.trim()) return false;
  const normalizedHtml = html.toLowerCase();
  const editorMarker =
    normalizedHtml.includes("data-vscode") ||
    normalizedHtml.includes("visual studio") ||
    normalizedHtml.includes("jetbrains") ||
    /font-family:[^;]*(consolas|cascadia|monaco|monospace|courier)/i.test(html);
  return editorMarker && !text.includes("```");
};

messageInput.addEventListener("paste", (event) => {
  const html = event.clipboardData?.getData("text/html") || "";
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!looksLikeEditorCode(html, text)) return;

  event.preventDefault();
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  const insertion = `\`\`\`\n${text.replace(/\r\n?/g, "\n").trimEnd()}\n\`\`\``;
  messageInput.setRangeText(insertion, start, end, "end");
  messageInput.dispatchEvent(new Event("input", { bubbles: true }));
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    postForm.requestSubmit();
  }
});

authorInput.addEventListener("input", () => {
  try {
    localStorage.setItem("class-wall-name", authorInput.value.trim());
  } catch {
    // Remembering the name is optional.
  }
  updateOwnTyping();
});

authorInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    messageInput.focus();
  }
});

fileInput.addEventListener("change", () => setSelectedFile(fileInput.files[0]));
removeFileButton.addEventListener("click", () => setSelectedFile(null));
selectedFilePreview.addEventListener("click", openSelectedImage);

["dragenter", "dragover"].forEach((eventName) => {
  postForm.addEventListener(eventName, (event) => {
    event.preventDefault();
    postForm.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  postForm.addEventListener(eventName, (event) => {
    event.preventDefault();
    postForm.classList.remove("is-dragging");
  });
});

postForm.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError();

  const message = messageInput.value.trim();
  const file = pendingFile;
  if (!message && !file) {
    showFormError("Write a message or attach a file.");
    messageInput.focus();
    return;
  }

  postButton.disabled = true;
  postForm.setAttribute("aria-busy", "true");

  try {
    const formData = new FormData();
    formData.set("author", authorInput.value);
    formData.set("message", messageInput.value);
    if (file) formData.set("file", file, file.name);
    if (replyingTo) formData.set("replyTo", replyingTo.id);
    sendTyping(false);

    const response = await fetch(POSTS_API, {
      method: "POST",
      headers: { "X-Host-Device": deviceToken },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.post) {
      throw new Error(data.error || "Could not send.");
    }

    posts = [data.post, ...posts.filter((post) => post.id !== data.post.id)].sort(
      (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
    );
    messageInput.value = "";
    resizeMessageInput();
    setSelectedFile(null);
    clearReply();
    renderPosts({ scroll: true });
    messageInput.focus();
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "Could not send.");
  } finally {
    postButton.disabled = false;
    postForm.setAttribute("aria-busy", "false");
  }
});

cancelReplyButton.addEventListener("click", clearReply);
replyMessageAction.addEventListener("click", () => {
  if (menuPost) setReply(menuPost);
});

deleteMessageAction.addEventListener("click", async () => {
  const post = menuPost;
  if (!post) return;
  closeMessageMenu();
  const headers = { "X-Host-Device": deviceToken };
  const adminKey = fridayAdminKey.value.trim();
  if (adminKey) headers["X-Friday-Admin"] = adminKey;
  try {
    const response = await fetch(`${POSTS_API}/${post.id}`, {
      method: "DELETE",
      headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not delete message.");
    posts = posts.filter((item) => item.id !== post.id);
    if (replyingTo?.id === post.id) clearReply();
    renderPosts();
  } catch (error) {
    showFormError(
      error instanceof Error ? error.message : "Could not delete message.",
    );
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!messageMenu.hidden && !messageMenu.contains(event.target)) closeMessageMenu();
});

closeDialogButton.addEventListener("click", () => imageDialog.close());
imageDialog.addEventListener("click", (event) => {
  if (event.target === imageDialog) imageDialog.close();
});
imageDialog.addEventListener("close", () => {
  dialogImage.removeAttribute("src");
  dialogDownload.removeAttribute("href");
  dialogDownload.removeAttribute("download");
});

const setCompactMode = (enabled) => {
  document.body.classList.toggle("is-compact", enabled);
  try {
    sessionStorage.setItem("class-wall-compact", enabled ? "1" : "0");
  } catch {
    // Compact mode still works without session storage.
  }
};

const toggleCompactMode = () => {
  setCompactMode(!document.body.classList.contains("is-compact"));
};

const openCompactWindow = () => {
  const compactUrl = new URL("/host/", window.location.href);
  compactUrl.searchParams.set("compact", "1");
  const compactWindow = window.open(
    compactUrl,
    "class-wall-compact",
    "popup=yes,width=420,height=680,resizable=yes,scrollbars=no",
  );
  compactWindow?.focus();
};

const setKnowledgeStatus = (message) => {
  knowledgeStatus.textContent = message;
};

const renderKnowledgeDocuments = (items) => {
  knowledgeList.replaceChildren(
    ...items.map((reference) => {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      const detail = document.createElement("small");
      name.textContent = reference.name;
      detail.textContent = `${reference.chunks} sections · ${formatBytes(reference.size)}`;
      item.append(name, detail);
      return item;
    }),
  );
};

const loadKnowledgeDocuments = async () => {
  const adminKey = fridayAdminKey.value.trim();
  if (!adminKey) {
    knowledgeList.replaceChildren();
    setKnowledgeStatus("");
    return;
  }
  try {
    const response = await fetch(KNOWLEDGE_API, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Friday-Admin": adminKey,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.documents)) {
      throw new Error(data.error || "Could not load references.");
    }
    renderKnowledgeDocuments(data.documents);
    setKnowledgeStatus(data.documents.length ? "" : "No references");
  } catch (error) {
    knowledgeList.replaceChildren();
    setKnowledgeStatus(
      error instanceof Error ? error.message : "Could not load references.",
    );
  }
};

const updateKnowledgeSelection = () => {
  const file = knowledgeFileInput.files[0] || null;
  knowledgeFile = file;
  if (file && file.size > MAX_KNOWLEDGE_BYTES) {
    knowledgeFile = null;
    knowledgeFileInput.value = "";
    knowledgeFileName.textContent = "Maximum reference size is 10 MB";
  } else {
    knowledgeFileName.textContent = file?.name || "No reference selected";
  }
  indexDocumentButton.disabled = !knowledgeFile;
};

const indexKnowledgeDocument = async () => {
  const adminKey = fridayAdminKey.value.trim();
  if (!adminKey) {
    setKnowledgeStatus("Enter the admin key.");
    fridayAdminKey.focus();
    return;
  }
  if (!knowledgeFile) return;

  indexDocumentButton.disabled = true;
  settingsDialog.setAttribute("aria-busy", "true");
  setKnowledgeStatus("Adding reference…");
  try {
    const formData = new FormData();
    formData.set("document", knowledgeFile, knowledgeFile.name);
    const response = await fetch(KNOWLEDGE_API, {
      method: "POST",
      headers: { "X-Friday-Admin": adminKey },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.document) {
      throw new Error(data.error || "Could not add reference.");
    }
    knowledgeFileInput.value = "";
    updateKnowledgeSelection();
    setKnowledgeStatus("Reference added");
    await loadKnowledgeDocuments();
  } catch (error) {
    setKnowledgeStatus(
      error instanceof Error ? error.message : "Could not add reference.",
    );
  } finally {
    settingsDialog.removeAttribute("aria-busy");
    indexDocumentButton.disabled = !knowledgeFile;
  }
};

settingsButton.addEventListener("click", () => {
  settingsDialog.showModal();
  loadKnowledgeDocuments();
});
closeSettingsButton.addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
compactWindowButton.addEventListener("click", openCompactWindow);
knowledgeFileInput.addEventListener("change", updateKnowledgeSelection);
indexDocumentButton.addEventListener("click", indexKnowledgeDocument);
fridayAdminKey.addEventListener("input", () => {
  window.clearTimeout(knowledgeTimer);
  knowledgeTimer = window.setTimeout(loadKnowledgeDocuments, 450);
  try {
    sessionStorage.setItem("friday-admin-key", fridayAdminKey.value);
  } catch {
    // The key remains available for this open page.
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !messageMenu.hidden) {
    closeMessageMenu();
    return;
  }
  if (event.code === "Numpad0" && !event.repeat) {
    event.preventDefault();
    toggleCompactMode();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadPosts({ silent: true });
});

try {
  authorInput.value = localStorage.getItem("class-wall-name") || "";
} catch {
  // The wall works normally without local storage.
}

try {
  fridayAdminKey.value = sessionStorage.getItem("friday-admin-key") || "";
  const compactRequested =
    new URLSearchParams(window.location.search).get("compact") === "1" ||
    sessionStorage.getItem("class-wall-compact") === "1";
  setCompactMode(compactRequested);
} catch {
  setCompactMode(new URLSearchParams(window.location.search).get("compact") === "1");
}

window.setInterval(() => {
  document.querySelectorAll("[data-relative-time]").forEach((time) => {
    time.textContent = relativeTime(time.dataset.relativeTime);
  });
}, 30_000);

window.setInterval(renderTypingStatus, 1000);

window.setInterval(() => {
  if (!document.hidden && socket?.readyState !== WebSocket.OPEN) {
    loadPosts({ silent: true });
  }
}, 15_000);
window.addEventListener("pagehide", () => sendTyping(false));
resizeMessageInput();
loadPosts();
connectLiveUpdates();
