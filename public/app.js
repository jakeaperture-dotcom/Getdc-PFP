const $ = (selector) => document.querySelector(selector);
const form = $("#lookup-form");
const input = $("#discord-user-id");
const lookupButton = $("#lookup-button");
const profile = $("#profile");
const avatarButton = $("#avatar-button");
const avatar = $("#avatar");
const username = $("#username");
const errorMessage = $("#lookup-error");
const downloadButton = $("#download-button");
const avatarDialog = $("#avatar-dialog");
const avatarDialogClose = $("#avatar-dialog-close");
const fullAvatar = $("#full-avatar");
const apiUrl = "/api/pfps/discord";

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (lookupButton.disabled) return;

  const userId = input.value.trim();

  profile.hidden = true;
  downloadButton.hidden = true;
  if (avatarDialog.open) avatarDialog.close();
  avatarButton.removeAttribute("aria-label");
  delete avatarButton.dataset.avatarUrl;
  downloadButton.removeAttribute("href");
  avatar.removeAttribute("src");
  fullAvatar.removeAttribute("src");
  errorMessage.hidden = true;
  input.removeAttribute("aria-invalid");

  if (!/^\d{17,20}$/.test(userId)) {
    errorMessage.textContent = "Enter a valid 17–20 digit Discord user ID.";
    errorMessage.hidden = false;
    input.setAttribute("aria-invalid", "true");
    return;
  }

  lookupButton.disabled = true;
  input.disabled = true;
  lookupButton.textContent = "Looking…";
  form.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(
      `${apiUrl}?userId=${encodeURIComponent(userId)}`,
    );
    const isJson = response.headers
      .get("content-type")
      ?.includes("application/json");
    const user = isJson ? await response.json() : null;

    if (!response.ok) {
      throw new Error(user?.error || "The lookup service is unavailable.");
    }

    if (!user?.username || !user?.avatarUrl) {
      throw new Error("The lookup service returned an invalid response.");
    }

    avatar.src = user.avatarUrl;
    avatar.alt = `${user.username}'s Discord avatar`;
    username.textContent = user.username;

    const fullAvatarUrl = new URL(user.avatarUrl);
    fullAvatarUrl.searchParams.set("size", "4096");
    avatarButton.dataset.avatarUrl = fullAvatarUrl.href;
    avatarButton.setAttribute(
      "aria-label",
      `View ${user.username}'s full-size avatar`,
    );
    fullAvatar.alt = `${user.username}'s full-size Discord avatar`;

    downloadButton.href = `${apiUrl}?userId=${userId}&download=1`;

    profile.hidden = false;
    downloadButton.hidden = false;
  } catch (error) {
    errorMessage.textContent =
      error instanceof Error && error.message !== "Failed to fetch"
        ? error.message
        : "The lookup service is unavailable. Try again.";
    errorMessage.hidden = false;
    input.setAttribute("aria-invalid", "true");
  } finally {
    lookupButton.disabled = false;
    input.disabled = false;
    lookupButton.textContent = "Look up";
    form.setAttribute("aria-busy", "false");
  }
});

avatarButton.addEventListener("click", () => {
  fullAvatar.src = avatarButton.dataset.avatarUrl;
  avatarDialog.showModal();
});

avatarDialogClose.addEventListener("click", () => avatarDialog.close());

avatarDialog.addEventListener("click", (event) => {
  if (event.target === avatarDialog) avatarDialog.close();
});
