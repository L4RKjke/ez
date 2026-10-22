(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const icon = document.getElementById("theme-icon");
  const label = document.getElementById("theme-label");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

if (!toggle || !icon || !label) return;


  let savedTheme = null;

  // Хранилище может быть недоступно в настройках браузера.
  try {
    savedTheme = localStorage.getItem("theme");
  } catch {
    // В этом случае переключение работает без сохранения.
  }

  if (savedTheme !== "light" && savedTheme !== "dark") {
    savedTheme = null;
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";

    root.dataset.theme = theme;

    icon.textContent = isDark ? "☀️" : "🌙";
    label.textContent = isDark ? "Светлая тема" : "Тёмная тема";

    toggle.setAttribute(
      "aria-label",
      isDark ? "Включить светлую тему" : "Включить тёмную тему"
    );
  }

  // При первом посещении используем тему системы.
  applyTheme(
    savedTheme ?? (systemTheme.matches ? "dark" : "light")
  );

  toggle.addEventListener("click", () => {
    const nextTheme =
      root.dataset.theme === "dark" ? "light" : "dark";

    savedTheme = nextTheme;
    applyTheme(nextTheme);

    try {
      localStorage.setItem("theme", nextTheme);
    } catch {
      // Тема уже переключена, даже если сохранить её не удалось.
    }
  });

  // Следуем настройкам системы, пока пользователь
  // не выбрал тему самостоятельно.
  systemTheme.addEventListener("change", (event) => {
    if (savedTheme === null) {
      applyTheme(event.matches ? "dark" : "light");
    }
  });
})();
