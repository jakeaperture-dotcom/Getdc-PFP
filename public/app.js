const searchInput = document.querySelector("#template-search");
const searchForm = document.querySelector("#template-search-form");
const filters = [...document.querySelectorAll("[data-template-filter]")];
const cards = [...document.querySelectorAll("[data-template-card]")];
const sections = [...document.querySelectorAll("[data-template-section]")];
const resultCount = document.querySelector("#result-count");
const emptyState = document.querySelector("#empty-state");

let activeCategory = "all";

const updateResults = () => {
  const query = searchInput.value.trim().toLowerCase();
  let visibleCount = 0;

  cards.forEach((card) => {
    const matchesCategory =
      activeCategory === "all" || card.dataset.category === activeCategory;
    const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
    const isVisible = matchesCategory && matchesQuery;

    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  sections.forEach((section) => {
    section.hidden = ![...section.querySelectorAll("[data-template-card]")].some(
      (card) => !card.hidden,
    );
  });

  resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? "template" : "templates"}`;
  emptyState.hidden = visibleCount !== 0;
};

filters.forEach((filter) => {
  filter.addEventListener("click", () => {
    activeCategory = filter.dataset.templateFilter;
    filters.forEach((button) => {
      button.setAttribute("aria-pressed", String(button === filter));
    });
    updateResults();
  });
});

searchInput.addEventListener("input", updateResults);

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateResults();
});

const orbit = document.querySelector("#template-orbit");
const orbitCards = [...document.querySelectorAll("[data-orbit-card]")];

if (orbit && orbitCards.length) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let phase = 0;
  let lastTime = 0;
  let isVisible = true;
  let radiusX = 0;
  let radiusY = 0;
  let visibleOrbitCards = orbitCards;

  const renderOrbit = () => {
    visibleOrbitCards.forEach((card, index) => {
      const angle = phase + (index / visibleOrbitCards.length) * Math.PI * 2;
      const x = Math.cos(angle) * radiusX;
      const y = Math.sin(angle) * radiusY;
      const depth = (Math.sin(angle) + 1) / 2;
      const scale = 0.72 + depth * 0.28;

      card.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale})`;
      card.style.opacity = String(0.4 + depth * 0.6);
      card.style.zIndex = String(4 + Math.round(depth * 8));
    });
  };

  const measureOrbit = () => {
    const { width, height } = orbit.getBoundingClientRect();
    visibleOrbitCards = orbitCards.filter(
      (card) => window.getComputedStyle(card).display !== "none",
    );
    radiusX = Math.max(0, Math.min((width - visibleOrbitCards[0].offsetWidth) / 2 - 8, 176));
    radiusY = Math.min(height * 0.26, 112);
    renderOrbit();
  };

  const animateOrbit = (time) => {
    if (!lastTime) lastTime = time;
    phase -= Math.min(time - lastTime, 32) * 0.00012;
    lastTime = time;
    renderOrbit();
    frame = window.requestAnimationFrame(animateOrbit);
  };

  const syncOrbit = () => {
    window.cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (isVisible && !document.hidden && !reducedMotion.matches) {
      frame = window.requestAnimationFrame(animateOrbit);
    }
  };

  new ResizeObserver(measureOrbit).observe(orbit);
  new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    syncOrbit();
  }).observe(orbit);

  document.addEventListener("visibilitychange", syncOrbit);
  reducedMotion.addEventListener("change", syncOrbit);
  measureOrbit();
  syncOrbit();
}
