import {
  animate,
  createScope,
  createTimeline,
  stagger,
  utils,
} from "./vendor/anime.esm.min.js";

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
const tutorialWindow = $(".tutorial-window");
const tutorialToggle = $("#tutorial-toggle");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const apiUrl = "/api/pfps/discord";

let tutorialTimeline;
let revealObserver;
let tutorialVisibilityObserver;
let tutorialVisible = true;
let tutorialUserPaused = false;

const motionScope = createScope({
  root: document.body,
  mediaQueries: {
    reduceMotion: "(prefers-reduced-motion: reduce)",
  },
}).add(({ matches }) => {
  const demoCards = document.querySelectorAll(".demo-card");
  const demoProgress = $(".demo-progress span");

  if (matches.reduceMotion) {
    utils.set(demoCards, { opacity: 1, y: 0, scale: 1 });
    utils.set(demoProgress, { scaleX: 1 });
    return;
  }

  createTimeline({
    defaults: { duration: 560, ease: "out(3)" },
  })
    .add(".tool h1", { opacity: [0, 1], y: [16, 0] }, 0)
    .add(".form-row", { opacity: [0, 1], y: [12, 0] }, 120);

  utils.set(demoCards, { opacity: 0, y: 16, scale: 0.98 });
  utils.set(demoCards[0], { opacity: 1, y: 0, scale: 1 });
  utils.set(demoProgress, { scaleX: 0 });

  tutorialTimeline = createTimeline({
    loop: true,
    defaults: { duration: 480, ease: "out(3)" },
  })
    .add(demoProgress, { scaleX: [0, 1], duration: 9000, ease: "linear" }, 0)
    .add(
      demoCards[0],
      { opacity: [1, 0], y: [0, -16], scale: [1, 0.98] },
      2600,
    )
    .add(
      demoCards[1],
      { opacity: [0, 1], y: [16, 0], scale: [0.98, 1] },
      3000,
    )
    .add(
      demoCards[1],
      { opacity: [1, 0], y: [0, -16], scale: [1, 0.98] },
      5600,
    )
    .add(
      demoCards[2],
      { opacity: [0, 1], y: [16, 0], scale: [0.98, 1] },
      6000,
    )
    .add(
      demoCards[2],
      { opacity: [1, 0], y: [0, -16], scale: [1, 0.98] },
      8600,
    );

  if ("IntersectionObserver" in window) {
    tutorialTimeline.pause();
    tutorialVisibilityObserver = new IntersectionObserver(
      ([entry]) => {
        tutorialVisible = entry.isIntersecting;
        if (tutorialVisible && !tutorialUserPaused) tutorialTimeline.play();
        else tutorialTimeline.pause();
      },
      { threshold: 0.1 },
    );
    tutorialVisibilityObserver.observe(tutorialWindow);
  }

  const revealGroups = [
    { trigger: $(".tutorial-heading"), targets: [$(".tutorial-heading")] },
    { trigger: $(".tutorial-player"), targets: [$(".tutorial-player")] },
    {
      trigger: $(".tutorial-steps"),
      targets: [...document.querySelectorAll(".tutorial-steps li")],
    },
    { trigger: $(".how-it-works"), targets: [$(".how-it-works")] },
    {
      trigger: $(".coming-soon-heading"),
      targets: [$(".coming-soon-heading")],
    },
    {
      trigger: $(".coming-soon-list"),
      targets: [...document.querySelectorAll(".coming-soon-list li")],
    },
  ].filter(({ trigger, targets }) => trigger && targets.every(Boolean));

  const revealTargets = revealGroups.flatMap(({ targets }) => targets);
  utils.set(revealTargets, { opacity: 0, y: 16 });

  const reveal = (targets) => {
    animate(targets, {
      opacity: 1,
      y: 0,
      duration: 480,
      delay: targets.length > 1 ? stagger(64) : 0,
      ease: "out(3)",
    });
  };

  if (!("IntersectionObserver" in window)) {
    revealGroups.forEach(({ targets }) => reveal(targets));
    return;
  }

  const targetsByTrigger = new Map(
    revealGroups.map(({ trigger, targets }) => [trigger, targets]),
  );

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        reveal(targetsByTrigger.get(entry.target));
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12%", threshold: 0.12 },
  );

  targetsByTrigger.forEach((_, trigger) => revealObserver.observe(trigger));

  return () => {
    revealObserver?.disconnect();
    tutorialVisibilityObserver?.disconnect();
    revealObserver = undefined;
    tutorialVisibilityObserver = undefined;
    tutorialTimeline = undefined;
    tutorialVisible = true;
    tutorialUserPaused = false;
  };
});

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
    if (!reduceMotion.matches) {
      animate(errorMessage, {
        opacity: [0, 1],
        y: [-8, 0],
        duration: 240,
        ease: "out(3)",
      });
    }
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

    if (!reduceMotion.matches) {
      animate(profile, {
        opacity: [0, 1],
        y: [16, 0],
        scale: [0.98, 1],
        duration: 480,
        ease: "out(3)",
      });
      animate(downloadButton, {
        opacity: [0, 1],
        y: [8, 0],
        duration: 360,
        delay: 120,
        ease: "out(3)",
      });
    }
  } catch (error) {
    errorMessage.textContent =
      error instanceof Error && error.message !== "Failed to fetch"
        ? error.message
        : "The lookup service is unavailable. Try again.";
    errorMessage.hidden = false;
    input.setAttribute("aria-invalid", "true");

    if (!reduceMotion.matches) {
      animate(errorMessage, {
        opacity: [0, 1],
        y: [-8, 0],
        duration: 240,
        ease: "out(3)",
      });
    }
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

  if (!reduceMotion.matches) {
    animate(avatarDialog, {
      opacity: [0, 1],
      scale: [0.98, 1],
      duration: 240,
      ease: "out(3)",
    });
  }
});

avatarDialogClose.addEventListener("click", () => avatarDialog.close());

avatarDialog.addEventListener("click", (event) => {
  if (event.target === avatarDialog) avatarDialog.close();
});

avatarDialog.addEventListener("close", () => {
  fullAvatar.removeAttribute("src");
});

tutorialToggle.addEventListener("click", () => {
  if (!tutorialTimeline) return;

  const isPaused = tutorialWindow.classList.toggle("is-paused");
  tutorialUserPaused = isPaused;
  if (isPaused || !tutorialVisible) tutorialTimeline.pause();
  else tutorialTimeline.play();
  tutorialToggle.textContent = isPaused ? "Play" : "Pause";
  tutorialToggle.setAttribute("aria-pressed", String(isPaused));
});

window.addEventListener(
  "pagehide",
  () => {
    revealObserver?.disconnect();
    tutorialVisibilityObserver?.disconnect();
    motionScope.revert();
  },
  { once: true },
);
