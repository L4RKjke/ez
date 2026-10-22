(() => {
  "use strict";

  const catalogURL = new URL("./vtx_catalog/", document.baseURI);

  const specFields = [
    "Диапазон",
    "Каналы",
    "Протокол",
    "Мощность",
    "Кулер",
    "Крепление",
    "Коннектор",
    "Основной цвет",
    "Дополнительный цвет",
    "Индикация"
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);

    return node;
  }

  function isObject(value) {
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value);
  }

  async function loadJSON(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return response.json();
  }

  // В полях с изображениями используются имена файлов
  // относительно папки конкретного видеопередатчика.
  function fileURL(folderURL, filename) {
    return new URL(encodeURIComponent(filename), folderURL).href;
  }

  function loadImage(image, url, onError, onLoad) {
    image.addEventListener("error", () => {
      image.hidden = true;
      if (onError) onError();
    }, { once: true });

    image.addEventListener("load", () => {
      if (onLoad) onLoad();
    }, { once: true });

    image.src = url;
  }

  /*
   * Формирование Betaflight vtxtable.
   *
   * Используется профиль default_protocol.
   * powers[].value — значение для протокола, НЕ powers[].mw.
   * CUSTOM — передача частоты, а не заводского номера канала.
   *
   * save намеренно не добавляется.
   */
  function buildCLI(config) {
    if (!isObject(config)) {
      throw new Error("Неверный формат конфигурации.");
    }

    const bands = config.bands;
    const protocol = config.default_protocol;
    const profile = config.profiles?.[protocol];
    const powers = profile?.powers;

    if (!Array.isArray(bands) || bands.length === 0) {
      throw new Error("В конфигурации нет bands.");
    }

    if (!Array.isArray(powers) || powers.length === 0) {
      throw new Error("Нет уровней мощности для default_protocol.");
    }

    const channels = bands[0]?.frequencies?.length;

    if (!Number.isInteger(channels) || channels < 1) {
      throw new Error("Не указаны частоты каналов.");
    }

    const bandLines = bands.map((band, index) => {
      if (!isObject(band)) {
        throw new Error(`Некорректный диапазон ${index + 1}.`);
      }

      const frequencies = band.frequencies;

      if (
        !Array.isArray(frequencies) ||
        frequencies.length !== channels ||
        !frequencies.every(
          (frequency) => Number.isInteger(frequency) && frequency >= 0
        )
      ) {
        throw new Error(
          "В диапазонах должны быть одинаковое число каналов " +
          "и целочисленные частоты."
        );
      }

      const name = String(band.name ?? "").toUpperCase();
      const letter = String(band.letter ?? "").toUpperCase();

      // Проверки также исключают внедрение дополнительных CLI-команд.
      if (!/^[A-Z0-9_-]{1,8}$/.test(name)) {
        throw new Error(
          `Название диапазона ${index + 1}: требуется 1–8 символов A–Z, 0–9, _ или -.`
        );
      }

      if (!/^[A-Z]$/.test(letter)) {
        throw new Error(
          `Буква диапазона ${index + 1} должна быть от A до Z.`
        );
      }

      return [
        "vtxtable band",
        index + 1,
        name,
        letter,
        "CUSTOM",
        ...frequencies
      ].join(" ");
    });

    const values = [];
    const labels = [];

    for (const power of powers) {
      if (
        !isObject(power) ||
        !Number.isInteger(power.value) ||
        power.value < 0
      ) {
        throw new Error("Некорректное значение мощности.");
      }

      const label = String(power.label ?? "");

      if (!/^[a-zA-Z0-9_-]{1,3}$/.test(label)) {
        throw new Error(
          "Метка мощности должна содержать 1–3 символа без пробелов."
        );
      }

      values.push(power.value);
      labels.push(label);
    }

    return [
      `vtxtable bands ${bands.length}`,
      `vtxtable channels ${channels}`,
      ...bandLines,
      `vtxtable powerlevels ${powers.length}`,
      `vtxtable powervalues ${values.join(" ")}`,
      `vtxtable powerlabels ${labels.join(" ")}`
    ].join("\n");
  }

  function setupTabs(card, id) {
    const tabs = [...card.querySelectorAll('[role="tab"]')];
    const panels = [...card.querySelectorAll('[role="tabpanel"]')];

    function activateTab(selectedTab, focus = false) {
      for (const tab of tabs) {
        const active = tab === selectedTab;

        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }

      for (const panel of panels) {
        panel.hidden =
          panel.dataset.panel !== selectedTab.dataset.tab;
      }

      if (focus) selectedTab.focus();
    }

    tabs.forEach((tab, index) => {
      const panel = panels.find(
        (item) => item.dataset.panel === tab.dataset.tab
      );

      tab.id = `${id}-tab-${index}`;
      panel.id = `${id}-panel-${index}`;

      tab.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-labelledby", tab.id);

      tab.addEventListener("click", () => activateTab(tab));

      tab.addEventListener("keydown", (event) => {
        let targetIndex;

        switch (event.key) {
          case "ArrowRight":
            targetIndex = (index + 1) % tabs.length;
            break;

          case "ArrowLeft":
            targetIndex = (index - 1 + tabs.length) % tabs.length;
            break;

          case "Home":
            targetIndex = 0;
            break;

          case "End":
            targetIndex = tabs.length - 1;
            break;

          default:
            return;
        }

        event.preventDefault();
        activateTab(tabs[targetIndex], true);
      });
    });
  }

  function setupCopy(card, cli) {
    const button = card.querySelector(".vtx-card__copy");
    const code = card.querySelector(".vtx-card__cli code");
    const status = card.querySelector(".vtx-card__copy-status");

    button.disabled = false;

    button.addEventListener("click", async () => {
      status.textContent = "";

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API недоступен.");
        }

        await navigator.clipboard.writeText(cli);
        status.textContent = "CLI скопирован.";
      } catch {
        // Резервный вариант: выделяем CLI для ручного копирования.
        const selection = window.getSelection();

        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(code);

          selection.removeAllRanges();
          selection.addRange(range);
        }

        status.textContent =
          "Автокопирование недоступно. Выделите CLI при необходимости " +
          "и скопируйте через Ctrl+C / ⌘C или меню браузера.";
      }
    });
  }

  function createCard(template, item, index) {
    const {
      folder,
      folderURL,
      description,
      config,
      descriptionError,
      configError
    } = item;

    const card = template.content
      .querySelector(".vtx-card")
      .cloneNode(true);

    const fallbackName = folder
      .replace(/^\d+_/, "")
      .replace(/_/g, " ");

    const name =
      typeof description["Название"] === "string" &&
      description["Название"].trim()
        ? description["Название"]
        : fallbackName;

    card.dataset.folder = folder;
    card.querySelector(".vtx-card__title").textContent = name;

    // Основное фото и заглушка.
    const image = card.querySelector(".vtx-card__image");
    const placeholder = card.querySelector(".vtx-card__placeholder");

    const photo = "фото.webp";

    image.alt = name;

    loadImage(
      image,
      fileURL(folderURL, photo),
      () => { placeholder.hidden = false; },
      () => { placeholder.hidden = true; }
    );

    // Краткие характеристики под названием.
    const badges = card.querySelector(".vtx-card__badges");

    for (const key of ["Диапазон", "Каналы", "Мощность", "Протокол"]) {
      const value = description[key];

      if (value === undefined || value === null || value === "") {
        continue;
      }

      const badge = element("span", "vtx-card__badge", value);
      badge.title = key;
      badges.append(badge);
    }

    // Вкладка описания.
    const specs = card.querySelector(".vtx-card__specs");

    for (const key of specFields) {
      const value = description[key];

      if (
        value === undefined ||
        value === null ||
        value === "" ||
        typeof value === "object"
      ) {
        continue;
      }

      const row = element("div", "vtx-card__spec-row");

      row.append(
        element("dt", "", key),
        element("dd", "", value)
      );

      specs.append(row);
    }

    if (!specs.children.length) {
      const panel = card.querySelector('[data-panel="description"]');

      panel.append(
        element(
          "p",
          "vtx-card__notice",
          descriptionError
            ? "Не удалось загрузить описание."
            : "Описание пока не добавлено."
        )
      );
    }

    // Индивидуальная распиновка.
    // Распиновка пока отображается как HTML-заглушка.
    // описание.json для неё не используется.
    // Изображение распиновки пока не загружаем.


    // CLI из vtx конфиг.json.
    const code = card.querySelector(".vtx-card__cli code");
    let cliError = configError;

    if (!configError) {
      try {
        const cli = buildCLI(config);

        code.textContent = cli;
        setupCopy(card, cli);
      } catch (error) {
        cliError = error;
      }
    }

    if (cliError) {
      code.textContent = "CLI недоступен.";

      card.querySelector(".vtx-card__copy-status").textContent =
        "Проверьте vtx конфиг.json. Подробности — в консоли.";

      console.error(`Ошибка CLI: ${folder}`, cliError);
    }

    setupTabs(card, `vtx-card-${index}`);

    // Для подключения существующего поиска.
    card.dataset.search = [
      name,
      ...specFields.map((key) => description[key] ?? "")
    ].join(" ").toLowerCase();

    return {
      card,
      hasError: Boolean(descriptionError || cliError)
    };
  }

  async function loadCatalogItem(folder) {
    const folderURL = new URL(
      `${encodeURIComponent(folder)}/`,
      catalogURL
    );

    const [descriptionResult, configResult] = await Promise.allSettled([
      loadJSON(fileURL(folderURL, "описание.json")),
      loadJSON(fileURL(folderURL, "vtx конфиг.json"))
    ]);

    const descriptionValid =
      descriptionResult.status === "fulfilled" &&
      isObject(descriptionResult.value);

    const configValid =
      configResult.status === "fulfilled" &&
      isObject(configResult.value);

    const descriptionError = descriptionValid
      ? null
      : descriptionResult.status === "rejected"
        ? descriptionResult.reason
        : new Error("описание.json должен содержать объект.");

    const configError = configValid
      ? null
      : configResult.status === "rejected"
        ? configResult.reason
        : new Error("vtx конфиг.json должен содержать объект.");

    if (descriptionError) {
      console.error(`Ошибка описания: ${folder}`, descriptionError);
    }

    return {
      folder,
      folderURL,
      description: descriptionValid ? descriptionResult.value : {},
      config: configValid ? configResult.value : null,
      descriptionError,
      configError
    };
  }

  async function initCatalog() {
    const container = document.getElementById("vtx-cards");
    const template = document.getElementById("vtx-card-template");
    const status = document.getElementById("vtx-catalog-status");

    if (!container || !template || !status) return;

    container.setAttribute("aria-busy", "true");
    status.textContent = "Загрузка видеопередатчиков…";

    try {
      const index = await loadJSON(new URL("index.json", catalogURL));

      if (
        !Array.isArray(index) ||
        !index.every(
          (folder) =>
            typeof folder === "string" &&
            folder.trim() !== "" &&
            folder !== "." &&
            folder !== ".." &&
            !/[\\/]/.test(folder)
        )
      ) {
        throw new Error(
          "index.json должен содержать массив имён папок."
        );
      }

      const folders = [...new Set(index)];

      // Загрузка параллельная, порядок остаётся как в index.json.
      const items = await Promise.all(
        folders.map((folder) => loadCatalogItem(folder))
      );

      const fragment = document.createDocumentFragment();
      let errors = 0;

      items.forEach((item, index) => {
        const result = createCard(template, item, index);

        fragment.append(result.card);
        if (result.hasError) errors++;
      });

      container.replaceChildren(fragment);

      if (!items.length) {
        status.textContent = "Каталог пока пуст.";
      } else if (errors) {
        status.textContent =
          `Карточек: ${items.length}. ` +
          `С неполными данными: ${errors}.`;
      } else {
        status.textContent = "";
      }

      container.dispatchEvent(
        new CustomEvent("catalog:loaded", {
          bubbles: true,
          detail: {
            count: items.length,
            errors
          }
        })
      );
    } catch (error) {
      console.error("Ошибка каталога:", error);

      status.textContent =
        "Не удалось загрузить каталог. " +
        "Проверьте vtx_catalog/index.json и консоль браузера.";
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  }

// Поиск
// Поиск с поддержкой динамической загрузки каталога
function normalizeCatalogText(text) {
    return String(text ?? "")
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

function filterCatalog() {
    // Получаем актуальные элементы после загрузки или перерисовки.
    const catalogSearch = document.getElementById("search");
    const catalogContainer = document.getElementById("vtx-cards");
    const catalogEmpty = document.getElementById("empty-state");
    
    if (!catalogSearch || !catalogContainer) return;

    const query = normalizeCatalogText(catalogSearch.value);
    const cards = catalogContainer.querySelectorAll(".vtx-card");

    let visibleCount = 0;

    cards.forEach((card) => {
        const title = card.querySelector("h3")?.textContent ?? "";
        const matches = normalizeCatalogText(title).includes(query);

        card.hidden = !matches;

        if (matches) {
            visibleCount++;
        }
    });

    if (catalogEmpty) {
        catalogEmpty.hidden = visibleCount > 0 || query === "";
    }
}

// Делегирование: работает, даже если поле появится позже
// или будет заменено при перерисовке.
document.addEventListener("input", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.matches("#search")) return;

    filterCatalog();
});

// Объединяем изменения DOM в один запуск фильтрации за кадр.
let catalogFilterScheduled = false;

function scheduleCatalogFilter() {
    if (catalogFilterScheduled) return;

    catalogFilterScheduled = true;

    requestAnimationFrame(() => {
        catalogFilterScheduled = false;
        filterCatalog();
    });
}

// Повторяем поиск при добавлении карточек, поля или контейнера,
// а также при изменении текста названий.
const catalogObserver = new MutationObserver(scheduleCatalogFilter);

catalogObserver.observe(document, {
    childList: true,
    subtree: true,
    characterData: true
    // Атрибуты не отслеживаем: изменение hidden
    // не должно запускать фильтрацию по кругу.
});

filterCatalog();

// фильтры


if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", initCatalog, {
    once: true
});
} else {
initCatalog();
}

})();
