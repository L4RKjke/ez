"use strict";

const MAX_RULES = 40;
const STANDARD_SLOTS = 10;

const PWM_MIN = 900;
const PWM_MAX = 2100;
const PWM_STEP = 25;
const PWM_STEPS = (PWM_MAX - PWM_MIN) / PWM_STEP;

const AUTO_PWM_MIN = 975;
const AUTO_PWM_MAX = 2025;
const AUTO_PWM_STEPS = (AUTO_PWM_MAX - AUTO_PWM_MIN) / PWM_STEP;

let nextId = 1;
let cliText = "";
let copyTimer;

const $ = (selector) => document.querySelector(selector);

const elements = {
  settings: $("#group-settings"),
  editor: $("#rules-editor"),
  count: $("#rule-count"),
  errors: $("#errors"),
  warning: $("#slot-warning"),
  code: $("#cli-code"),
  commandCount: $("#command-count"),
  copy: $("#copy-button"),
  status: $("#copy-status"),
};

function makeRule(group, index = 0) {
  return {
    id: nextId++,
    group,
    aux: group === "channel" ? 2 : 1,
    band: group === "channel" ? 5 : 0,
    channel: group === "channel" ? (index % 8) + 1 : 0,
    power: group === "channel" ? 0 : (index % 8) + 1,
    min: PWM_MIN,
    max: PWM_MAX,
  };
}

const state = {
  mode: "split",

  settings: {
    power: { auto: true, shared: true, aux: 1 },
    channel: { auto: true, shared: true, aux: 2 },
    unified: { auto: false, shared: false, aux: 1 },
  },

  rules: [
    makeRule("power", 0),
    makeRule("power", 1),
    makeRule("power", 2),
    makeRule("channel", 0),
    makeRule("channel", 3),
    makeRule("channel", 7),
  ],
};

const titles = {
  power: "Мощность",
  channel: "Каналы",
  unified: "Все параметры",
};

function activeGroups() {
  return state.mode === "unified" ? ["unified"] : ["power", "channel"];
}

function groupRules(group) {
  return group === "unified"
    ? state.rules
    : state.rules.filter((rule) => rule.group === group);
}

function orderedRules() {
  return activeGroups().flatMap(groupRules);
}

function effectiveGroup(rule) {
  return state.mode === "unified" ? "unified" : rule.group;
}

function effectiveValues(rule) {
  const group = effectiveGroup(rule);
  const settings = state.settings[group];

  let min = rule.min;
  let max = rule.max;

  if (settings.auto) {
    const rules = groupRules(group);
    const index = rules.findIndex((item) => item.id === rule.id);

    min =
      AUTO_PWM_MIN +
      Math.floor((index * AUTO_PWM_STEPS) / rules.length) * PWM_STEP;

    max =
      AUTO_PWM_MIN +
      Math.floor(((index + 1) * AUTO_PWM_STEPS) / rules.length) * PWM_STEP;
  }

  return {
    aux: settings.shared ? settings.aux : rule.aux,
    min,
    max,
  };
}

// Записываем фактические значения перед отключением автоматики
// или переключением режима.
function materializeRules(rules) {
  const snapshots = rules.map((rule) => ({
    rule,
    values: effectiveValues(rule),
  }));

  for (const { rule, values } of snapshots) {
    Object.assign(rule, values);
  }
}

function numericValue(value) {
  return Number.isFinite(value) ? value : "";
}

function renderSettings() {
  elements.settings.classList.toggle("unified", state.mode === "unified");

  elements.settings.innerHTML = activeGroups()
    .map((group) => {
      const settings = state.settings[group];

      return `
      <div class="setting-card" data-settings="${group}">
        <div class="setting-title">${titles[group]}</div>

        <label class="check">
          <input
            type="checkbox"
            data-setting="auto"
            ${settings.auto ? "checked" : ""}
          >
          Авто ШИМ
        </label>

        <label class="check">
          <input
            type="checkbox"
            data-setting="shared"
            ${settings.shared ? "checked" : ""}
          >
          Один AUX для всех правил
        </label>

        <label class="shared-aux" ${settings.shared ? "" : "hidden"}>
          <span>AUX</span>
          <input
            type="number"
            data-setting="aux"
            min="1"
            max="14"
            step="1"
            required
            value="${numericValue(settings.aux)}"
            aria-label="Общий AUX: ${titles[group]}"
          >
        </label>
      </div>
    `;
    })
    .join("");
}

function field(label, key, value, min, max, step = 1) {
  const pwmClass = key === "min" || key === "max" ? " pwm" : "";

  return `
    <label class="field${pwmClass}">
      <span>${label}</span>
      <input
        type="number"
        data-field="${key}"
        value="${numericValue(value)}"
        min="${min}"
        max="${max}"
        step="${step}"
        required
      >
    </label>
  `;
}

function renderRule(rule, index) {
  const group = effectiveGroup(rule);
  const settings = state.settings[group];
  const values = effectiveValues(rule);
  const unified = state.mode === "unified";

  let fields = "";

  if (!settings.shared) {
    fields += field("AUX", "aux", rule.aux, 1, 14);
  }

  if (unified || rule.group === "channel") {
    fields += field("Band", "band", rule.band, 0, 8);
    fields += field("Канал", "channel", rule.channel, 0, 8);
  }

  // Смешанное правило сохраняет редактируемую мощность
  // даже при возвращении в двухколоночный режим.
  if (unified || rule.group === "power" || rule.power !== 0) {
    fields += field("Мощн.", "power", rule.power, 0, 8);
  }

  if (!settings.auto) {
    fields += field("ШИМ от", "min", rule.min, PWM_MIN, PWM_MAX, PWM_STEP);

    fields += field("ШИМ до", "max", rule.max, PWM_MIN, PWM_MAX, PWM_STEP);
  }

  const meta = [];

  if (settings.shared) {
    meta.push(`AUX ${numericValue(values.aux) || "—"}`);
  }

  if (settings.auto) {
    meta.push(`ШИМ ${values.min}–${values.max}`);
  }

  return `
    <div class="rule" data-id="${rule.id}">
      <div class="rule-fields">
        <span class="rule-index">#${index + 1}</span>
        ${fields}

        <button
          type="button"
          class="remove-button"
          data-remove
          title="Удалить правило"
          aria-label="Удалить правило ${index + 1}"
        >×</button>
      </div>

      ${
        meta.length
          ? `<div class="rule-meta">
              ${meta.map((text) => `<span>${text}</span>`).join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function renderRules() {
  elements.editor.classList.toggle("unified", state.mode === "unified");

  let offset = 0;

  elements.editor.innerHTML = activeGroups()
    .map((group) => {
      const rules = groupRules(group);

      const content = rules
        .map((rule, index) => {
          return renderRule(rule, offset + index);
        })
        .join("");

      offset += rules.length;

      return `
      <section class="rule-group">
        <header class="group-header">
          <h3>${titles[group]}</h3>
          <span class="badge">${rules.length}</span>
        </header>

        <div class="rule-list">
          ${content || '<p class="empty">Нет правил</p>'}
        </div>

        <button
          type="button"
          class="button add-button"
          data-add="${group}"
          ${state.rules.length >= MAX_RULES ? "disabled" : ""}
        >+ Добавить правило</button>
      </section>
    `;
    })
    .join("");
}

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validate() {
  const errors = [];

  orderedRules().forEach((rule, index) => {
    const values = effectiveValues(rule);
    const prefix = `Правило ${index + 1}:`;

    if (!inRange(values.aux, 1, 14)) {
      errors.push(`${prefix} AUX должен быть целым числом от 1 до 14.`);
    }

    const validIndexes = ["band", "channel", "power"].every((key) => {
      return inRange(rule[key], 0, 8);
    });

    if (!validIndexes) {
      errors.push(`${prefix} Band, канал и мощность — целые числа 0–8.`);
    }

    const validPWM =
      inRange(values.min, PWM_MIN, PWM_MAX) &&
      inRange(values.max, PWM_MIN, PWM_MAX) &&
      values.min < values.max &&
      (values.min - PWM_MIN) % PWM_STEP === 0 &&
      (values.max - PWM_MIN) % PWM_STEP === 0;

    if (!validPWM) {
      errors.push(`${prefix} ШИМ — 900–2100 с шагом 25; начало меньше конца.`);
    }
  });

  return errors;
}

function clearCopyStatus() {
  clearTimeout(copyTimer);
  elements.status.textContent = "";
}

function updateCLI() {
  clearCopyStatus();
  window.dispatchEvent(new Event("vtx:change"));

  const errors = validate();
  const rules = orderedRules();

  elements.count.textContent = `${rules.length} / ${MAX_RULES}`;
  elements.warning.hidden = rules.length <= STANDARD_SLOTS;

  elements.errors.hidden = errors.length === 0;
  elements.errors.textContent = errors.join("\n");
  elements.copy.disabled = errors.length > 0;

  if (errors.length) {
    cliText = "";
    elements.code.textContent = "Исправьте значения в редакторе.";
    elements.commandCount.textContent = "Есть ошибки";
    return;
  }

  const lines = rules.map((rule, index) => {
    const values = effectiveValues(rule);

    return [
      "vtx",
      index,
      values.aux - 1,
      rule.band,
      rule.channel,
      rule.power,
      values.min,
      values.max,
    ].join(" ");
  });

  // Очищаем неиспользуемые стандартные слоты.
  // Комментарии в генерируемый CLI не добавляются.
  for (let slot = rules.length; slot < STANDARD_SLOTS; slot++) {
    lines.push(`vtx ${slot} 0 0 0 0 900 900`);
  }

  const totalCommands = lines.length + 1;

  lines.push("", "save");
  cliText = lines.join("\n");

  elements.code.textContent = cliText;
  elements.commandCount.textContent = `${totalCommands} команд`;
}

function render() {
  renderSettings();
  renderRules();
  updateCLI();
}

// Переключение режима без потери фактических значений.
document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    const mode = event.target.value;

    if (mode === state.mode) return;

    const rules = orderedRules();
    materializeRules(rules);

    // Сохраняем текущий порядок при переходе в единый список.
    state.rules = [...rules];

    if (mode === "split") {
      for (const rule of state.rules) {
        rule.group =
          rule.band !== 0 || rule.channel !== 0 ? "channel" : "power";
      }
    }

    state.mode = mode;

    // Не позволяем настройкам другого режима
    // неожиданно перезаписать текущие значения.
    for (const group of activeGroups()) {
      state.settings[group].auto = false;
      state.settings[group].shared = false;
    }

    render();
  });
});

// Переключатели автоматических настроек.
elements.settings.addEventListener("change", (event) => {
  const input = event.target;
  const key = input.dataset.setting;

  if (key !== "auto" && key !== "shared") return;

  const card = input.closest("[data-settings]");
  const group = card.dataset.settings;
  const settings = state.settings[group];

  if (settings[key] && !input.checked) {
    materializeRules(groupRules(group));
  }

  settings[key] = input.checked;
  render();
});

// Изменение общего AUX.
elements.settings.addEventListener("input", (event) => {
  const input = event.target;

  if (input.dataset.setting !== "aux") return;

  const group = input.closest("[data-settings]").dataset.settings;
  state.settings[group].aux = input.valueAsNumber;

  renderRules();
  updateCLI();
});

// Добавление и удаление правил.
elements.editor.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");

  if (add) {
    if (state.rules.length >= MAX_RULES) return;

    const group = add.dataset.add;
    const baseGroup = group === "unified" ? "power" : group;
    const rule = makeRule(baseGroup, groupRules(group).length);

    rule.aux = state.settings[group].aux;
    state.rules.push(rule);

    renderRules();
    updateCLI();
    return;
  }

  const remove = event.target.closest("[data-remove]");

  if (remove) {
    const id = Number(remove.closest("[data-id]").dataset.id);

    state.rules = state.rules.filter((rule) => rule.id !== id);

    renderRules();
    updateCLI();
  }
});

// Обновляем только CLI, не пересоздавая поле во время ввода.
elements.editor.addEventListener("input", (event) => {
  const input = event.target;
  const key = input.dataset.field;

  if (!key) return;

  const row = input.closest("[data-id]");
  const rule = state.rules.find((item) => item.id === Number(row.dataset.id));

  if (!rule) return;

  rule[key] = input.valueAsNumber;
  updateCLI();
});
// Резервное копирование для окружений без Clipboard API.
function fallbackCopy(text) {
  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";

  document.body.append(textarea);
  textarea.select();

  let success;

  try {
    success = document.execCommand("copy");
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }

  if (!success) {
    throw new Error("Не удалось скопировать");
  }
}

elements.copy.addEventListener("click", async () => {
  if (!cliText) return;

  const text = cliText;
  clearCopyStatus();

  try {
    try {
      if (!navigator.clipboard || !window.isSecureContext) {
        throw new Error("Clipboard API недоступен");
      }

      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }

    elements.status.textContent = "Команды скопированы";
  } catch {
    elements.status.textContent =
      "Не удалось скопировать. Выделите команды вручную.";
  }

  copyTimer = setTimeout(() => {
    elements.status.textContent = "";
  }, 4000);
});

window.vtxBridge = {
  getSnapshot() {
    return {
      mode: state.mode,
      maxRules: MAX_RULES,
      errors: validate(),

      rules: orderedRules().map(rule => {
        const values = effectiveValues(rule);

        return {
          id: rule.id,
          group: rule.group,
          aux: values.aux,
          band: rule.band,
          channel: rule.channel,
          power: rule.power,
          min: values.min,
          max: values.max
        };
      })
    };
  },

  setGroupCount(group, count) {
    if (state.mode !== "split") {
      throw new Error(
        "Выбор количества доступен в режиме двух колонок."
      );
    }

    if (group !== "power" && group !== "channel") {
      throw new Error("Неизвестная колонка.");
    }

    if (!Number.isInteger(count) || count < 0 || count > MAX_RULES) {
      throw new Error(`Введите целое число от 0 до ${MAX_RULES}.`);
    }

    const current = groupRules(group);
    const otherCount = state.rules.length - current.length;

    if (otherCount + count > MAX_RULES) {
      throw new Error(
        `Общий лимит — ${MAX_RULES} правил. ` +
        `Для этой колонки доступно ${MAX_RULES - otherCount}.`
      );
    }

    if (count < current.length) {
      const removedIds = new Set(
        current.slice(count).map(rule => rule.id)
      );

      state.rules = state.rules.filter(rule => {
        return !removedIds.has(rule.id);
      });
    }

    for (let index = current.length; index < count; index++) {
      const rule = makeRule(group, index);
      rule.aux = state.settings[group].aux;
      state.rules.push(rule);
    }

    state.settings[group].auto = true;
    render();
  }
};


render();
