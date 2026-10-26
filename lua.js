(() => {
  "use strict";

  const TEMPLATE_FILE = "MPX template.lua";

  const $ = (selector) => document.querySelector(selector);

  const ui = {
    open: $("#lua-button"),
    dialog: $("#lua-dialog"),
    close: $("#lua-close"),

    settingsTab: $("#lua-settings-tab"),
    codeTab: $("#lua-code-tab"),
    settingsPane: $("#lua-settings-pane"),
    codePane: $("#lua-code-pane"),

    source: $("#lua-source"),
    switchCount: $("#lua-switch-count"),

    incSwitch: $("#lua-inc-switch"),
    incState: $("#lua-inc-state"),

    decCard: $("#lua-dec-card"),
    decSwitch: $("#lua-dec-switch"),
    decState: $("#lua-dec-state"),

    hold: $("#lua-hold"),
    delay: $("#lua-delay"),
    voice: $("#lua-voice"),
    cyclic: $("#lua-cyclic"),

    preview: $("#lua-preview-body"),
    output: $("#lua-output"),
    error: $("#lua-error"),
    status: $("#lua-status"),

    reload: $("#lua-reload"),
    copy: $("#lua-copy"),

    powerCount: $("#power-rule-count"),
    channelCount: $("#channel-rule-count"),
    countHint: $("#count-hint"),
  };

  const bridge = window.vtxBridge;

  if (!bridge) {
    console.error("Сначала подключите configuration.js с vtxBridge.");
    return;
  }

  let template = "";
  let generatedScript = "";
  let loading = false;
  let templateError = "";
  let copyTimer;

  const switchNames = ["sa", "sb", "sc", "sd", "se", "sf", "sg", "sh"];

  for (const select of [ui.incSwitch, ui.decSwitch]) {
    for (const name of switchNames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name.toUpperCase();
      select.append(option);
    }
  }

  ui.incSwitch.value = "sb";
  ui.decSwitch.value = "sc";

  function setError(message = "") {
    ui.error.hidden = !message;
    ui.error.textContent = message;
  }

  function resetCopyStatus() {
    clearTimeout(copyTimer);
    ui.status.textContent = "";
  }

  function showTab(name, focus = false) {
    const settings = name === "settings";

    ui.settingsPane.hidden = !settings;
    ui.codePane.hidden = settings;

    ui.settingsTab.classList.toggle("active", settings);
    ui.codeTab.classList.toggle("active", !settings);

    ui.settingsTab.setAttribute("aria-selected", String(settings));
    ui.codeTab.setAttribute("aria-selected", String(!settings));

    ui.settingsTab.tabIndex = settings ? 0 : -1;
    ui.codeTab.tabIndex = settings ? -1 : 0;

    if (focus) {
      (settings ? ui.settingsTab : ui.codeTab).focus();
    }
  }

  function syncCounts() {
    const snapshot = bridge.getSnapshot();
    const split = snapshot.mode === "split";

    ui.powerCount.disabled = !split;
    ui.channelCount.disabled = !split;

    ui.powerCount.value = snapshot.rules.filter((rule) => {
      return rule.group === "power";
    }).length;

    ui.channelCount.value = snapshot.rules.filter((rule) => {
      return rule.group === "channel";
    }).length;

    ui.powerCount.setCustomValidity("");
    ui.channelCount.setCustomValidity("");

    ui.countHint.textContent = split
      ? "Изменение количества включает Авто ШИМ колонки. " +
        "Общий лимит — 40 правил. Уменьшение удаляет последние правила."
      : "Выбор количества доступен в режиме двух колонок. " +
        "В едином списке используйте добавление и удаление правил.";

    for (const option of ui.source.options) {
      option.disabled = !split && option.value !== "all";
    }

    if (!split) {
      ui.source.value = "all";
    }
  }

  function bindCount(input, group) {
    input.addEventListener("input", () => {
      input.setCustomValidity("");
    });

    input.addEventListener("change", () => {
      try {
        bridge.setGroupCount(group, input.valueAsNumber);
        input.setCustomValidity("");
      } catch (error) {
        input.setCustomValidity(error.message);
        input.reportValidity();
      }
    });
  }

  bindCount(ui.powerCount, "power");
  bindCount(ui.channelCount, "channel");

  /*
   * Стандартное преобразование:
   *
   * PWM = 1500 + VALUE * 5
   * VALUE = (PWM - 1500) / 5
   *
   * Выбираем целое значение возле центра диапазона.
   * Верхнюю границу считаем исключённой.
   * Если внутри правила доступно значение от -99 до 99,
   * крайние -100 / 100 не используем.
   */
  function mixerValue(rule, position) {
    const lowest = Math.max(-100, Math.ceil((rule.min - 1500) / 5));

    const highest = Math.min(100, Math.ceil((rule.max - 1500) / 5) - 1);

    if (lowest > highest) {
      throw new Error(
        `Позиция ${position}: диапазон ${rule.min}–${rule.max} ` +
          "невозможно активировать значением микшера от −100 до 100. " +
          "Измените ШИМ или включите Авто ШИМ.",
      );
    }

    let safeLowest = Math.max(lowest, -99);
    let safeHighest = Math.min(highest, 99);

    // Крайние значения разрешаем только при отсутствии
    // подходящего внутреннего значения.
    if (safeLowest > safeHighest) {
      safeLowest = lowest;
      safeHighest = highest;
    }

    const center = (rule.min + rule.max) / 2;
    const preferred = Math.round((center - 1500) / 5);

    return Math.max(safeLowest, Math.min(safeHighest, preferred));
  }

  function luaArray(values) {
    return `{ ${values.join(", ")} }`;
  }

  function luaBoolean(value) {
    return value ? "true" : "false";
  }

  function luaSwitch(id, state) {
    return `{ id = "${id}", state = "${state}" }`;
  }

  function selectedRules(snapshot) {
    if (ui.source.value === "all") {
      return snapshot.rules;
    }

    return snapshot.rules.filter((rule) => {
      return rule.group === ui.source.value;
    });
  }

  function buildParameters(snapshot) {
    if (snapshot.errors.length) {
      throw new Error(
        "Исправьте ошибки VTX-правил:\n" + snapshot.errors.join("\n"),
      );
    }

    const rules = selectedRules(snapshot);

    if (!rules.length) {
      throw new Error(
        "Нет правил для генерации. Добавьте правила " +
          "или измените выбранную колонку.",
      );
    }

    const useDec = ui.switchCount.value === "2";

    if (
      useDec &&
      ui.incSwitch.value === ui.decSwitch.value &&
      ui.incState.value === ui.decState.value
    ) {
      throw new Error(
        "Для шагов +1 и −1 нельзя выбрать одно и то же " +
          "положение одного переключателя.",
      );
    }

    const delay = ui.delay.valueAsNumber;

    if (
      !Number.isFinite(delay) ||
      delay < 0.1 ||
      delay > 3600 ||
      Math.abs(delay * 10 - Math.round(delay * 10)) > 0.000001
    ) {
      throw new Error(
        "Задержка должна быть от 0.1 до 3600 секунд с шагом 0.1.",
      );
    }

    const positions = rules.map((rule, index) => ({
      rule,
      channel: rule.aux + 4,
      value: mixerValue(rule, index + 1),
    }));

    return {
      positions,

      replacements: {
        POSITIONS: String(rules.length),

        CHANNELS: luaArray(positions.map((item) => item.channel)),

        VALUES: luaArray(positions.map((item) => item.value)),

        FREQUENCIES: luaArray(rules.map(() => 0)),

        POWERS: luaArray(rules.map((rule) => rule.power)),

        INC_SWITCH: luaSwitch(ui.incSwitch.value, ui.incState.value),

        DEC_SWITCH: useDec
          ? luaSwitch(ui.decSwitch.value, ui.decState.value)
          : "nil",

        CYCLIC: luaBoolean(ui.cyclic.checked),
        VOICE: luaBoolean(ui.voice.checked),
        HOLD: luaBoolean(ui.hold.checked),
        DELAY: String(delay),
      },
    };
  }

  /*
   * Поддерживается формат шаблона из сообщения:
   *
   *   KEY = значение,
   *
   * Каждое изменяемое поле должно находиться на отдельной строке
   * и встречаться ровно один раз.
   *
   * Сохраняются отступы, наличие завершающей запятой,
   * комментарий и остальные строки.
   */
  function patchTemplate(source, replacements) {
    let result = source;

    for (const [key, value] of Object.entries(replacements)) {
      const pattern = new RegExp(
        `^([\\t ]*)${key}[\\t ]*=[\\t ]*([^\\r\\n]*)`,
        "gm",
      );

      let matches = 0;

      result = result.replace(pattern, (_, indent, rightSide) => {
        matches++;

        const commentIndex = rightSide.indexOf("--");

        const expression =
          commentIndex >= 0 ? rightSide.slice(0, commentIndex) : rightSide;

        const comment =
          commentIndex >= 0 ? ` ${rightSide.slice(commentIndex)}` : "";

        const comma = expression.trimEnd().endsWith(",") ? "," : "";

        return `${indent}${key} = ${value}${comma}${comment}`;
      });

      if (matches !== 1) {
        throw new Error(
          `В шаблоне поле ${key} найдено ${matches} раз. ` +
            "Нужна ровно одна строка вида: " +
            `${key} = значение`,
        );
      }
    }

    return result;
  }

  function renderPreview(positions) {
    ui.preview.replaceChildren();

    positions.forEach((item, index) => {
      const row = document.createElement("tr");

      const values = [
        index + 1,
        `AUX${item.rule.aux} / CH${item.channel}`,
        `${item.rule.min}–${item.rule.max}`,
        item.value,
        item.rule.power,
      ];

      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }

      ui.preview.append(row);
    });
  }

  function regenerate() {
    resetCopyStatus();
    setError();

    generatedScript = "";
    ui.copy.disabled = true;
    ui.output.value = "";
    ui.preview.replaceChildren();

    ui.decCard.hidden = ui.switchCount.value !== "2";
    ui.delay.disabled = !ui.hold.checked;

    try {
      const snapshot = bridge.getSnapshot();
      const data = buildParameters(snapshot);

      renderPreview(data.positions);

      if (loading) {
        ui.status.textContent = "Загрузка шаблона…";
        return;
      }

      if (!template) {
        if (templateError) {
          setError(templateError);
        } else {
          ui.status.textContent = "Шаблон ещё не загружен.";
        }

        return;
      }

      generatedScript = patchTemplate(template, data.replacements);

      ui.output.value = generatedScript;
      ui.copy.disabled = false;

      ui.status.textContent = `Позиций: ${data.positions.length}. Скрипт обновлён.`;
    } catch (error) {
      setError(error.message);
    }
  }

  async function loadTemplate() {
    if (loading) return;

    loading = true;
    template = "";
    templateError = "";

    ui.reload.disabled = true;
    regenerate();

    try {
      const url = new URL(TEMPLATE_FILE, document.baseURI);

      const response = await fetch(url, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      template = await response.text();

      if (!template.trim()) {
        throw new Error("Файл шаблона пуст.");
      }
    } catch (error) {
      template = "";

      templateError =
        `Не удалось загрузить «${TEMPLATE_FILE}»: ${error.message}\n` +
        "Поместите файл рядом с index.html. " +
        "Открывайте сайт через GitHub Pages или локальный HTTP-сервер, " +
        "а не через file://.";
    } finally {
      loading = false;
      ui.reload.disabled = false;
      regenerate();
    }
  }

  function fallbackCopy(text) {
    const previousFocus = document.activeElement;
    const textarea = document.createElement("textarea");

    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";

    // Вставляем внутрь dialog: внешний DOM при showModal() неактивен.
    ui.dialog.append(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
      previousFocus?.focus();
    }

    if (!copied) {
      throw new Error("Буфер обмена недоступен.");
    }
  }
  ui.open.addEventListener("click", () => {
    syncCounts();

    if (!ui.dialog.open) {
      ui.dialog.showModal();
    }

    regenerate();

    if (!template && !loading) {
      loadTemplate();
    }
  });

  ui.close.addEventListener("click", () => {
    ui.dialog.close();
  });

  ui.dialog.addEventListener("close", () => {
    ui.open.focus();
  });

  ui.settingsTab.addEventListener("click", () => {
    showTab("settings");
  });

  ui.codeTab.addEventListener("click", () => {
    showTab("code");
  });

  // Клавиатурное переключение вкладок.
  [ui.settingsTab, ui.codeTab].forEach((tab) => {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }

      event.preventDefault();

      if (event.key === "Home") {
        showTab("settings", true);
      } else if (event.key === "End") {
        showTab("code", true);
      } else {
        showTab(tab === ui.settingsTab ? "code" : "settings", true);
      }
    });
  });

  ui.settingsPane.addEventListener("input", (event) => {
    if (event.target.matches("input, select")) {
      regenerate();
    }
  });

  ui.reload.addEventListener("click", loadTemplate);

  ui.copy.addEventListener("click", async () => {
    if (!generatedScript) return;

    const text = generatedScript;
    resetCopyStatus();

    try {
      try {
        if (!navigator.clipboard || !window.isSecureContext) {
          throw new Error("Clipboard API недоступен.");
        }

        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopy(text);
      }

      ui.status.textContent = "Полный Lua-скрипт скопирован.";

      copyTimer = setTimeout(() => {
        ui.status.textContent = "Скрипт готов.";
      }, 3000);
    } catch {
      showTab("code");
      ui.output.focus();
      ui.output.select();

      ui.status.textContent =
        "Автокопирование недоступно. Скрипт выделен — нажмите Ctrl+C.";
    }
  });

  // Кнопка скачивания скрипта в виде MPX.lua.
  const downloadButton = ui.dialog.querySelector("#download-script");

  downloadButton.addEventListener("click", () => {
    if (!generatedScript) {
      ui.status.textContent = "Сначала дождитесь генерации скрипта.";
      return;
    }

    const blob = new Blob([generatedScript], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "MPX.lua";
    link.hidden = true;

    // Добавляем внутрь dialog, так как он открыт через showModal().
    ui.dialog.append(link);

    try {
      link.click();

      resetCopyStatus();
      ui.status.textContent = "Скачивание MPX.lua запущено.";

      copyTimer = setTimeout(() => {
        ui.status.textContent = "Скрипт готов.";
      }, 3000);
    } finally {
      link.remove();

      // Освобождаем URL с задержкой, чтобы браузер успел начать скачивание.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });

  // Инструкциия
  function initLuaTabs() {
    const tabs = Array.from(
      document.querySelectorAll('[role="tab"][data-lua-tab]'),
    );

    if (!tabs.length) return;

    function activateTab(selectedTab) {
      tabs.forEach((tab) => {
        const isActive = tab === selectedTab;
        const panel = document.getElementById(
          tab.getAttribute("aria-controls"),
        );

        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;

        if (panel) {
          panel.hidden = !isActive;
        }
      });
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        activateTab(tab);
      });

      tab.addEventListener("keydown", (event) => {
        let nextIndex;

        switch (event.key) {
          case "ArrowRight":
            nextIndex = (index + 1) % tabs.length;
            break;
          case "ArrowLeft":
            nextIndex = (index - 1 + tabs.length) % tabs.length;
            break;
          case "Home":
            nextIndex = 0;
            break;
          case "End":
            nextIndex = tabs.length - 1;
            break;
          default:
            return;
        }

        event.preventDefault();
        activateTab(tabs[nextIndex]);
        tabs[nextIndex].focus();
      });
    });

    const initialTab =
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ||
      tabs[0];

    activateTab(initialTab);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLuaTabs, { once: true });
  } else {
    initLuaTabs();
  }

  window.addEventListener("vtx:change", () => {
    syncCounts();

    if (ui.dialog.open) {
      regenerate();
    }
  });

  syncCounts();
})();
