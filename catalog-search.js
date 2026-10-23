(() => {
  "use strict";

  const FILTER_TITLES = {
    protocol: "Протокол",
    power: "Мощность",
    channels: "Каналы",
    band: "Диапазон",
  };

  const collator = new Intl.Collator("ru", {
    numeric: true,
    sensitivity: "base",
  });

  function normalizeText(text) {
    return String(text ?? "")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanText(text) {
    return String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeProtocol(value) {
    const normalized = normalizeText(value).replace(/\s+/g, "");

    if (normalized === "smartaudio") return "SmartAudio";
    if (normalized === "irctramp") return "IRC Tramp";

    // Другие протоколы не добавляем в список фильтров.
    return "";
  }

  function readCard(card) {
    const badges = new Map();

    card
      .querySelectorAll(".vtx-card__badge[title]")
      .forEach((badge) => {
        badges.set(
          cleanText(badge.getAttribute("title")),
          cleanText(badge.textContent)
        );
      });

    return {
      element: card,
      title: normalizeText(
        card.querySelector("h3")?.textContent
      ),
      protocol: normalizeProtocol(badges.get("Протокол")),
      power: badges.get("Мощность") ?? "",
      channels: badges.get("Каналы") ?? "",
      band: badges.get("Диапазон") ?? "",
    };
  }

  function getSelects(panel) {
    return Object.fromEntries(
      Object.keys(FILTER_TITLES).map((key) => [
        key,
        panel?.querySelector(`select[data-filter="${key}"]`) ?? null,
      ])
    );
  }

  function updateSelect(select, key, values) {
    if (!select) return;

    const expectedOptions = [
      {
        value: "",
        label: `${FILTER_TITLES[key]}: все`,
      },
      ...values.map((value) => ({
        value,
        label: value,
      })),
    ];

    // Не перерисовываем неизменившийся список.
    // Это также предотвращает цикл MutationObserver.
    const unchanged =
      select.options.length === expectedOptions.length &&
      expectedOptions.every((option, index) => {
        const current = select.options[index];

        return (
          current.value === option.value &&
          current.textContent === option.label
        );
      });

    if (unchanged) return;

    const previousValue = select.value;
    const fragment = document.createDocumentFragment();

    expectedOptions.forEach(({ value, label }) => {
      fragment.append(new Option(label, value));
    });

    select.replaceChildren(fragment);

    // Сохраняем выбранный фильтр, если он есть в новом списке.
    select.value = values.includes(previousValue)
      ? previousValue
      : "";
  }

  function updateFilterOptions(selects, cards) {
    // Протоколы всегда ограничены этими двумя вариантами.
    updateSelect(selects.protocol, "protocol", [
      "SmartAudio",
      "IRC Tramp",
    ]);

    // Остальные варианты собираем из всех карточек,
    // включая скрытые поиском или фильтрами.
    for (const key of ["power", "channels", "band"]) {
      const values = [
        ...new Set(
          cards
            .map((card) => card[key])
            .filter(Boolean)
        ),
      ].sort((a, b) => collator.compare(a, b));

      updateSelect(selects[key], key, values);
    }
  }

  function syncFilterButtons(panel) {
    document.querySelectorAll(".filter-button").forEach((button) => {
      button.setAttribute("aria-controls", "vtx-filters");
      button.setAttribute(
        "aria-expanded",
        String(Boolean(panel && !panel.hidden))
      );
    });
  }

  function applyCatalogFilters() {
    const container = document.getElementById("vtx-cards");
    const search = document.getElementById("search");
    const panel = document.getElementById("vtx-filters");
    const emptyState = document.getElementById("empty-state");

    syncFilterButtons(panel);

    if (!container) return;

    const cards = Array.from(
      container.querySelectorAll(".vtx-card"),
      readCard
    );
    const selects = getSelects(panel);

    updateFilterOptions(selects, cards);

    const query = normalizeText(search?.value);

    const selected = Object.fromEntries(
      Object.keys(FILTER_TITLES).map((key) => [
        key,
        selects[key]?.value ?? "",
      ])
    );

    let visibleCount = 0;

    cards.forEach((card) => {
      const matchesSearch = card.title.includes(query);

      const matchesFilters = Object.entries(selected).every(
        ([key, value]) => !value || card[key] === value
      );

      const visible = matchesSearch && matchesFilters;

      card.element.hidden = !visible;

      if (visible) visibleCount++;
    });

    if (emptyState) {
      const hasActiveConditions =
        query !== "" ||
        Object.values(selected).some(Boolean);

      emptyState.hidden =
        visibleCount > 0 || !hasActiveConditions;
    }
  }

  // Объединяем несколько обновлений в один запуск за кадр.
  let updateScheduled = false;

  function scheduleCatalogUpdate() {
    if (updateScheduled) return;

    updateScheduled = true;

    requestAnimationFrame(() => {
      updateScheduled = false;
      applyCatalogFilters();
    });
  }

  function initCatalogSearch() {
    // Открытие и закрытие панели.
    // Делегирование работает и для динамически добавленной кнопки.
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;

      const button = event.target.closest(".filter-button");
      if (!button) return;

      event.preventDefault();

      const panel = document.getElementById("vtx-filters");
      if (!panel) return;

      panel.hidden = !panel.hidden;

      syncFilterButtons(panel);
      scheduleCatalogUpdate();
      console.log("Filter panel toggled:", !panel.hidden);
    });

    // Поиск по названию.
    document.addEventListener("input", (event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.matches("#search")) return;

      scheduleCatalogUpdate();
    });

    // Изменение любого фильтра.
    document.addEventListener("change", (event) => {
      if (!(event.target instanceof Element)) return;

      if (
        !event.target.matches(
          "#vtx-filters select[data-filter]"
        )
      ) {
        return;
      }

      scheduleCatalogUpdate();
    });

    // Отслеживаем асинхронную загрузку и замену карточек,
    // появление панели, изменение названий и бейджей.
    const observer = new MutationObserver(scheduleCatalogUpdate);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      // hidden и aria-атрибуты не отслеживаем,
      // чтобы не запускать обновления по кругу.
    });
    console.log("Catalog search initialized.");
    applyCatalogFilters();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initCatalogSearch,
      { once: true }
    );
  } else {
    initCatalogSearch();
  }
})();
