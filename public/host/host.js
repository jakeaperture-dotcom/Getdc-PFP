const MAX_FILE_BYTES = 20 * 1024 * 1024;
const POSTS_API = "/api/host/posts";

const postForm = document.querySelector("#post-form");
const authorInput = document.querySelector("#author");
const messageInput = document.querySelector("#message");
const messageCount = document.querySelector("#message-count");
const fileInput = document.querySelector("#file");
const fileDrop = document.querySelector("#file-drop");
const selectedFile = document.querySelector("#selected-file");
const selectedFileType = document.querySelector("#selected-file-type");
const selectedFileName = document.querySelector("#selected-file-name");
const selectedFileSize = document.querySelector("#selected-file-size");
const removeFileButton = document.querySelector("#remove-file");
const formError = document.querySelector("#form-error");
const postButton = document.querySelector("#post-button");
const postGrid = document.querySelector("#post-grid");
const postCount = document.querySelector("#post-count");
const feedStatus = document.querySelector("#feed-status");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const liveStatus = document.querySelector("#live-status");
const copyLinkButton = document.querySelector("#copy-link");
const imageDialog = document.querySelector("#image-dialog");
const dialogImage = document.querySelector("#dialog-image");
const dialogTitle = document.querySelector("#image-dialog-title");
const dialogDownload = document.querySelector("#dialog-download");
const closeDialogButton = document.querySelector("#close-dialog");

let posts = [];
let activeFilter = "all";
let socket;
let reconnectTimer;
let reconnectAttempts = 0;
let isLoadingPosts = false;
let pendingFile = null;

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
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dateTimeFormatter.format(new Date(timestamp));
};

const avatarHue = (name) =>
  [...name].reduce((total, character) => total + character.codePointAt(0), 0) %
  360;

const avatarInitials = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}` : words[0]?.[0] || "A")
    .toUpperCase()
    .slice(0, 2);
};

const showFormError = (message) => {
  formError.textContent = message;
  formError.hidden = false;
};

const clearFormError = () => {
  formError.textContent = "";
  formError.hidden = true;
};

const setSelectedFile = (file) => {
  clearFormError();
  pendingFile = file || null;

  if (!file) {
    selectedFile.hidden = true;
    fileInput.value = "";
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    pendingFile = null;
    showFormError("Choose a file that is 20 MB or smaller.");
    selectedFile.hidden = true;
    fileInput.value = "";
    return;
  }

  selectedFileType.textContent = fileExtension(file.name);
  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = `${formatBytes(file.size)} · ready to share`;
  selectedFile.hidden = false;
};

const openImage = (post) => {
  dialogImage.src = post.file.previewUrl;
  dialogImage.alt = `${post.file.name}, shared by ${post.author}`;
  dialogTitle.textContent = post.file.name;
  dialogDownload.href = post.file.downloadUrl;
  imageDialog.showModal();
};

const createFileRow = (post) => {
  const link = document.createElement("a");
  const badge = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("small");
  const download = document.createElement("span");

  link.className = "post-file";
  link.href = post.file.downloadUrl;
  link.setAttribute("download", post.file.name);
  badge.className = "post-file-type";
  badge.textContent = fileExtension(post.file.name);
  copy.className = "post-file-copy";
  title.textContent = post.file.name;
  detail.textContent = `${formatBytes(post.file.size)} · ${post.file.type || "file"}`;
  copy.append(title, detail);
  download.className = "post-file-download";
  download.textContent = "Download";
  link.append(badge, copy, download);
  return link;
};

const createPostCard = (post) => {
  const article = document.createElement("article");
  const header = document.createElement("header");
  const avatar = document.createElement("span");
  const identity = document.createElement("span");
  const author = document.createElement("strong");
  const time = document.createElement("time");

  article.className = "post-card";
  article.dataset.postId = post.id;
  header.className = "post-header";
  avatar.className = "post-avatar";
  avatar.style.setProperty("--avatar-hue", String(avatarHue(post.author)));
  avatar.textContent = avatarInitials(post.author);
  identity.className = "post-identity";
  author.textContent = post.author;
  time.dateTime = post.createdAt;
  time.title = new Date(post.createdAt).toLocaleString();
  time.dataset.relativeTime = post.createdAt;
  time.textContent = relativeTime(post.createdAt);
  identity.append(author, time);
  header.append(avatar, identity);
  article.append(header);

  if (post.message) {
    const message = document.createElement("p");
    message.className = "post-message";
    message.textContent = post.message;
    article.append(message);
  }

  if (post.file?.previewUrl) {
    const previewButton = document.createElement("button");
    const image = document.createElement("img");
    previewButton.className = "post-image";
    previewButton.type = "button";
    previewButton.setAttribute("aria-label", `Open ${post.file.name}`);
    image.src = post.file.previewUrl;
    image.alt = `${post.file.name}, shared by ${post.author}`;
    image.loading = "lazy";
    image.decoding = "async";
    previewButton.append(image);
    previewButton.addEventListener("click", () => openImage(post));
    article.append(previewButton);
  }

  if (post.file) article.append(createFileRow(post));
  return article;
};

const filteredPosts = () =>
  posts.filter((post) => {
    if (activeFilter === "images") return Boolean(post.file?.previewUrl);
    if (activeFilter === "files") return Boolean(post.file);
    return true;
  });

const renderPosts = () => {
  const visiblePosts = filteredPosts();
  postGrid.replaceChildren(...visiblePosts.map(createPostCard));
  postCount.textContent = posts.length ? `(${posts.length})` : "";

  if (!visiblePosts.length) {
    feedStatus.innerHTML = "";
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = posts.length ? "Nothing matches this filter." : "The wall is empty.";
    detail.textContent = posts.length
      ? "Choose another view to see the rest of the wall."
      : "Be the first person to share something with the room.";
    feedStatus.append(title, detail);
    feedStatus.hidden = false;
  } else {
    feedStatus.hidden = true;
  }
};

const loadPosts = async ({ silent = false } = {}) => {
  if (isLoadingPosts) return;
  isLoadingPosts = true;

  if (!silent && !posts.length) {
    feedStatus.hidden = false;
    feedStatus.textContent = "Loading the wall…";
  }

  try {
    const response = await fetch(POSTS_API, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.posts)) {
      throw new Error(data.error || "The wall could not be loaded.");
    }
    posts = data.posts;
    renderPosts();
  } catch (error) {
    if (!posts.length) {
      feedStatus.innerHTML = "";
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      title.textContent = "The wall is unavailable.";
      detail.textContent = error instanceof Error ? error.message : "Try again in a moment.";
      feedStatus.append(title, detail);
      feedStatus.hidden = false;
    }
  } finally {
    isLoadingPosts = false;
  }
};

const setLiveState = (state, label) => {
  liveStatus.dataset.state = state;
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
    setLiveState("offline", "Refreshing");
    reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempts);
    reconnectTimer = window.setTimeout(connectLiveUpdates, delay);
  });

  socket.addEventListener("error", () => socket.close());
};

messageInput.addEventListener("input", () => {
  messageCount.textContent = `${messageInput.value.length} / 1200`;
  clearFormError();
});

fileInput.addEventListener("change", () => setSelectedFile(fileInput.files[0]));
removeFileButton.addEventListener("click", () => setSelectedFile(null));

["dragenter", "dragover"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.remove("is-dragging");
  });
});

fileDrop.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  setSelectedFile(file);
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError();

  const message = messageInput.value.trim();
  const file = pendingFile;
  if (!message && !file) {
    showFormError("Write a note or choose a file before posting.");
    messageInput.focus();
    return;
  }
  if (file && file.size > MAX_FILE_BYTES) {
    showFormError("Choose a file that is 20 MB or smaller.");
    return;
  }

  postButton.disabled = true;
  postButton.querySelector("span").textContent = "Posting…";
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
      throw new Error(data.error || "The post could not be shared.");
    }

    const savedName = authorInput.value.trim();
    try {
      localStorage.setItem("class-wall-name", savedName);
    } catch {
      // Saving the optional display name is a convenience only.
    }

    posts = [data.post, ...posts.filter((post) => post.id !== data.post.id)];
    messageInput.value = "";
    messageCount.textContent = "0 / 1200";
    setSelectedFile(null);
    renderPosts();
    document.querySelector(`[data-post-id="${data.post.id}"]`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  } catch (error) {
    showFormError(
      error instanceof Error ? error.message : "The post could not be shared.",
    );
  } finally {
    postButton.disabled = false;
    postButton.querySelector("span").textContent = "Post to the wall";
    postForm.setAttribute("aria-busy", "false");
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((candidate) => {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    renderPosts();
  });
});

copyLinkButton.addEventListener("click", async () => {
  const label = copyLinkButton.querySelector("span");
  try {
    await navigator.clipboard.writeText(window.location.href);
    label.textContent = "Copied";
  } catch {
    label.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    label.textContent = "Copy link";
  }, 1800);
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
  // The wall works normally when local storage is unavailable.
}

window.setInterval(() => {
  document.querySelectorAll("[data-relative-time]").forEach((time) => {
    time.textContent = relativeTime(time.dataset.relativeTime);
  });
}, 30_000);

window.setInterval(() => loadPosts({ silent: true }), 15_000);
loadPosts();
connectLiveUpdates();
