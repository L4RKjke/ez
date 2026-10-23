function initTabs() {
  const buttons = document.querySelectorAll(".nav-button[data-section]");
  const sections = [
    document.getElementById("catalog"),
    document.getElementById("configuration"),
  ].filter(Boolean);

  function activateSection(sectionId) {
    if (!sections.some((section) => section.id === sectionId)) return;

    sections.forEach((section) => {
      section.hidden = section.id !== sectionId;
    });

    buttons.forEach((button) => {
      const active = button.dataset.section === sectionId;
      button.setAttribute("aria-pressed", String(active));
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      activateSection(button.dataset.section);
    });
  });

  // Раздел по умолчанию.
  activateSection("configuration");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTabs, { once: true });
} else {
  initTabs();
}
