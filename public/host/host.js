const MAX_FILE_BYTES = 20 * 1024 * 1024;
const POSTS_API = "/api/host/posts";

const chatStream = document.querySelector("#chat-stream");
const postGrid = document.querySelector("#post-grid");
const feedStatus = document.querySelector("#feed-status");
const liveStatus = document.querySelector("#live-status");
const postForm = document.querySelector("#post-form");
const authorInput = document.querySelector("#author");
const messageInput = document.querySelector("#message");
const fileInput = document.querySelector("#file");
const selectedFile = document.querySelector("#selected-file");
const selectedFileType = document.querySelector("#selected-file-type");
const selectedFileName = document.querySelector("#selected-file-name");
const selectedFileSize = document.querySelector("#selected-file-size");
const removeFileButton = document.querySelector("#remove-file");
const formError = document.querySelector("#form-error");
const postButton = document.querySelector("#post-button");
const imageDialog = document.querySelector("#image-dialog");
const dialogImage = document.querySelector("#dialog-image");
const dialogDownload = document.querySelector("#dialog-download");
const closeDialogButton = document.querySelector("#close-dialog");

let posts = [];
let pendingFile = null;
let socket;
let reconnectTimer;
let reconnectAttempts = 0;
let isLoadingPosts = false;
let errorTimer;

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
  pendingFile = file || null;

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
  selectedFile.hidden = false;
};

const createDownloadIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", "M12 4v11m0 0-4-4m4 4 4-4M5 20h14");
  svg.append(path);
  return svg;
};

const createFileLink = (post) => {
  const link = document.createElement("a");
  const type = document.createElement("span");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const size = document.createElement("small");

  link.className = "message-file";
  link.href = post.file.downloadUrl;
  link.setAttribute("download", post.file.name);
  link.setAttribute("aria-label", `Download ${post.file.name}`);
  type.className = "file-type";
  type.textContent = fileExtension(post.file.name);
  copy.className = "file-copy";
  name.textContent = post.file.name;
  size.textContent = formatBytes(post.file.size);
  copy.append(name, size);
  link.append(type, copy, createDownloadIcon());
  return link;
};

const openImage = (post) => {
  dialogImage.src = post.file.previewUrl;
  dialogImage.alt = `${post.file.name}, shared by ${post.author}`;
  dialogDownload.href = post.file.downloadUrl;
  imageDialog.showModal();
};

const createMessage = (post) => {
  const message = document.createElement("article");
  const meta = document.createElement("div");
  const author = document.createElement("strong");
  const time = document.createElement("time");
  const bubble = document.createElement("div");
  const currentName = authorInput.value.trim();
  const isOwn = Boolean(currentName) && post.author === currentName;

  message.className = `message${isOwn ? " is-own" : ""}`;
  message.dataset.postId = post.id;
  meta.className = "message-meta";
  author.textContent = post.author;
  time.dateTime = post.createdAt;
  time.title = new Date(post.createdAt).toLocaleString();
  time.dataset.relativeTime = post.createdAt;
  time.textContent = relativeTime(post.createdAt);
  meta.append(author, time);
  bubble.className = "message-bubble";

  if (post.message) {
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = post.message;
    bubble.append(text);
  }

  if (post.file?.previewUrl) {
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

  if (post.file) bubble.append(createFileLink(post));
  message.append(meta, bubble);
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
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
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
  });

  socket.addEventListener("message", (event) => {
    if (event.data === "pong") return;
    try {
      const update = JSON.parse(event.data);
      if (update.type === "post.created") loadPosts({ silent: true });
    } catch {
      // Ignore messages that are not wall events.
    }
  });

  socket.addEventListener("close", () => {
    setLiveState("offline", "Reconnecting");
    reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempts);
    reconnectTimer = window.setTimeout(connectLiveUpdates, delay);
  });

  socket.addEventListener("error", () => socket.close());
};

messageInput.addEventListener("input", () => {
  clearFormError();
  resizeMessageInput();
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
  renderPosts();
});

authorInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    messageInput.focus();
  }
});

fileInput.addEventListener("change", () => setSelectedFile(fileInput.files[0]));
removeFileButton.addEventListener("click", () => setSelectedFile(null));

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

    const response = await fetch(POSTS_API, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok || !data.post) {
      throw new Error(data.error || "Could not send.");
    }

    posts = [data.post, ...posts.filter((post) => post.id !== data.post.id)];
    messageInput.value = "";
    resizeMessageInput();
    setSelectedFile(null);
    renderPosts({ scroll: true });
    messageInput.focus();
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "Could not send.");
  } finally {
    postButton.disabled = false;
    postForm.setAttribute("aria-busy", "false");
  }
});

closeDialogButton.addEventListener("click", () => imageDialog.close());
imageDialog.addEventListener("click", (event) => {
  if (event.target === imageDialog) imageDialog.close();
});
imageDialog.addEventListener("close", () => {
  dialogImage.removeAttribute("src");
  dialogDownload.removeAttribute("href");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadPosts({ silent: true });
});

try {
  authorInput.value = localStorage.getItem("class-wall-name") || "";
} catch {
  // The wall works normally without local storage.
}

window.setInterval(() => {
  document.querySelectorAll("[data-relative-time]").forEach((time) => {
    time.textContent = relativeTime(time.dataset.relativeTime);
  });
}, 30_000);

window.setInterval(() => loadPosts({ silent: true }), 15_000);
resizeMessageInput();
loadPosts();
connectLiveUpdates();
