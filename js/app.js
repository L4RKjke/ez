import { loadCatalog } from "./catalog.js";
import { AUX_COUNT, assignPWM } from "./pwm.js";
import { buildCLI } from "./cli.js";
import { loadLuaTemplate, buildLua } from "./lua.js";

const $ = id => document.getElementById(id);

const state = {
  devices: [],
  selectedId: "",
  protocol: "",
  uart: 1,
  band: 1,
  channel: 1,
  enableRules: true,

  powerRules: [],
  channelRules: [],

  template: "",
  templateRevision: 0,

  lua: {
    switchCount: 1,
    incSwitch: "sb",
    incState: "up",
    decSwitch: "sc",
    decState: "down",
    hold: false,
    delay: 3,
    voice: true
  }
};

let nextRuleId = 1;
let toastTimer;

function element(tag, className = "", text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function selectedDevice() {
  return state.devices.find(item => item.id === state.selectedId) || null;
}

function currentProfile() {
  return selectedDevice()?.config.profiles[state.protocol] || null;
}

function getBands() {
  return selectedDevice()?.config.bands || [
    { name: "BAND_A", letter: "A", frequencies: Array(8).fill(0) },
    { name: "BAND_B", letter: "B", frequencies: Array(8).fill(0) },
    { name: "BAND_E", letter: "E", frequencies: Array(8).fill(0) },
    { name: "BAND_F", letter: "F", frequencies: Array(8).fill(0) },
    { name: "RACEBAND", letter: "R", frequencies: Array(8).fill(0) }
  ];
}

function fillSelect(select, options, value) {
  select.replaceChildren();

  for (const option of options) {
    const node = new Option(String(option.label), String(option.value));
    node.disabled = Boolean(option.disabled);
    select.add(node);
  }

  select.value = String(value);
}

function bandOptions() {
  return getBands().map((band, index) => ({
    value: index + 1,
    label: `${band.letter} · ${band.name}`
  }));
}

function channelOptions(bandNumber) {
  const band = getBands()[bandNumber - 1];

  return band.frequencies.map((frequency, index) => ({
    value: index + 1,
    label: frequency
      ? `${index + 1} · ${frequency} МГц`
      : `Канал ${index + 1}`
  }));
}

function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

async function copyText(text) {
  if (!text.trim()) {
    notify("Нет данных для копирования.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    notify("Скопировано в буфер обмена.");
  } catch {
    notify(
      "Браузер запретил копирование. Используйте HTTPS/localhost " +
      "или выделите текст вручную."
    );
  }
}

function showPage(name) {
  for (const tab of document.querySelectorAll("[data-page]")) {
    const active = tab.dataset.page === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  $("catalog-page").hidden = name !== "catalog";
  $("configuration-page").hidden = name !== "configuration";
}

function showLuaPage(name) {
  for (const tab of document.querySelectorAll("[data-lua-page]")) {
    const active = tab.dataset.luaPage === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  $("lua-settings").hidden = name !== "settings";
  $("lua-script").hidden = name !== "script";
}

function setupTabs(selector, activate) {
  const tabs = [...document.querySelectorAll(selector)];

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));

    tab.addEventListener("keydown", event => {
      let next;

      if (event.key === "ArrowRight") {
        next = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft") {
        next = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
}

function appendImage(container, device) {
  container.replaceChildren();

  const image = element("img");
  image.src = device.image;
  image.alt = device.name;
  image.loading = "lazy";

  image.addEventListener("error", () => {
    container.replaceChildren(element("span", "", "Фото не добавлено"));
  });

  container.append(image);
}

function appendSpecs(container, description, keys = null) {
  container.replaceChildren();

  const entries = keys
    ? keys.map(key => [key, description[key] ?? "—"])
    : Object.entries(description).filter(([key]) => key !== "Название");

  for (const [key, value] of entries) {
    container.append(
      element("dt", "", key),
      element("dd", "", String(value))
    );
  }
}

function renderCatalog() {
  const query = $("catalog-search").value.trim().toLocaleLowerCase("ru");
  const devices = state.devices.filter(device =>
    device.name.toLocaleLowerCase("ru").includes(query)
  );

  $("catalog-count").textContent = `${devices.length} моделей`;

  $("catalog-status").textContent = devices.length
    ? ""
    : state.devices.length
      ? "По вашему запросу ничего не найдено."
      : "Каталог пока пуст.";

  const grid = $("catalog-grid");
  grid.replaceChildren();

  for (const device of devices) {
    const card = element("article", "product-card");
    const image = element("div", "product-image");
    const body = element("div", "product-body");
    const title = element("h2", "", device.name);
    const specs = element("dl", "spec-list");
    const button = element(
      "button",
      "button primary",
      "Посмотреть конфигурацию"
    );

    title.style.marginBottom = "18px";
    button.type = "button";
    button.disabled = !device.config;
    button.title = device.configError;

    appendImage(image, device);
    appendSpecs(specs, device.description);

    button.addEventListener("click", () => {
      selectDevice(device.id);
      showPage("configuration");
      $("configuration-tab").focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    body.append(title, specs);

    if (device.descriptionError || device.configError) {
      const note = element(
        "p",
        "hint",
        [device.descriptionError, device.configError].filter(Boolean).join(" ")
      );
      note.style.marginBottom = "16px";
      body.append(note);
    }

    body.append(button);
    card.append(image, body);
    grid.append(card);
  }
}

function renderDeviceSelector() {
  fillSelect(
    $("transmitter"),
    [
      { value: "", label: "Не выбран — только VTX-правила" },
      ...state.devices.map(device => ({
        value: device.id,
        label: device.config
          ? device.name
          : `${device.name} — конфигурация недоступна`,
        disabled: !device.config
      }))
    ],
    state.selectedId
  );
}

function normalizeRules() {
  const bands = getBands();
  const profile = currentProfile();

  for (const rule of state.powerRules) {
    if (profile) {
      rule.power = Math.max(1, Math.min(rule.power, profile.powers.length));
    }
  }

  for (const rule of state.channelRules) {
    rule.band = Math.max(1, Math.min(rule.band, bands.length));
    rule.channel = Math.max(
      1,
      Math.min(rule.channel, bands[rule.band - 1].frequencies.length)
    );
  }
}

function selectDevice(id) {
  const device = state.devices.find(item => item.id === id);

  state.selectedId = device?.config ? id : "";
  state.protocol = device?.config?.default_protocol || "";
  state.band = 1;
  state.channel = 1;

  $("transmitter").value = state.selectedId;

  normalizeRules();
  renderDeviceSettings();
  renderRules();
  updateVisibility();
  updateOutputs();
}

function renderDeviceSettings() {
  const device = selectedDevice();

  if (!device) {
    return;
  }

  $("transmitter-name").textContent = device.name;
  appendImage($("transmitter-image"), device);
  appendSpecs(
    $("transmitter-description"),
    device.description,
    ["Протокол", "Мощность", "Диапазон", "Каналы"]
  );

  const profiles = Object.keys(device.config.profiles);

  fillSelect(
    $("protocol"),
    profiles.map(name => ({ value: name, label: name })),
    state.protocol
  );

  $("protocol").disabled = profiles.length === 1;

  fillSelect($("base-band"), bandOptions(), state.band);
  fillSelect($("base-channel"), channelOptions(state.band), state.channel);
}

function updateVisibility() {
  const hasDevice = Boolean(selectedDevice());

  $("transmitter-panel").hidden = !hasDevice;
  $("rules-panel").hidden = hasDevice && !state.enableRules;
}

function createRule(kind, index) {
  const rule = {
    id: `r${nextRuleId++}`,
    kind,
    aux: 1
  };

  if (kind === "power") {
    const count = currentProfile()?.powers.length;

    rule.power = count ? index % count + 1 : index + 1;
  } else {
    const combinations = getBands().flatMap((band, bandIndex) =>
      band.frequencies.map((_, channelIndex) => ({
        band: bandIndex + 1,
        channel: channelIndex + 1
      }))
    );

    Object.assign(rule, combinations[index % combinations.length]);
  }

  return rule;
}

function resizeRules(kind, count) {
  const rules = kind === "power" ? state.powerRules : state.channelRules;

  if (count < rules.length) {
    rules.length = count;
  }

  while (rules.length < count) {
    rules.push(createRule(kind, rules.length));
  }
}

function bindRuleCount(id, kind) {
  const input = $(id);

  input.addEventListener("input", () => {
    const count = input.valueAsNumber;

    const valid =
      input.value !== "" &&
      Number.isSafeInteger(count) &&
      count >= 0 &&
      count <= 4294967295;

    input.setCustomValidity(
      valid ? "" : "Введите целое неотрицательное количество правил."
    );

    if (!valid) {
      updateOutputs();
      return;
    }

    resizeRules(kind, count);
    renderRules();
    updateOutputs();
  });
}

function labeledControl(title, control, className = "") {
  const label = element("label", className);
  label.append(document.createTextNode(title), control);
  return label;
}

function createSelect(options, value, onChange) {
  const select = element("select");
  fillSelect(select, options, value);

  select.addEventListener("change", () => {
    onChange(select.value);
  });

  return select;
}

function renderRule(rule, index) {
  const card = element("div", "rule-card");
  const fields = element("div", "rule-fields");

  card.append(element("div", "rule-number", `ПРАВИЛО ${index + 1}`));

  const aux = createSelect(
    Array.from({ length: AUX_COUNT }, (_, i) => ({
      value: i + 1,
      label: `AUX${i + 1} · CH${i + 5}`
    })),
    rule.aux,
    value => {
      rule.aux = Number(value);
      updateOutputs();
    }
  );

  fields.append(labeledControl("AUX / канал приёмника", aux));

  if (rule.kind === "power") {
    const profile = currentProfile();
    let power;

    if (profile) {
      power = createSelect(
        profile.powers.map((item, i) => ({
          value: i + 1,
          label: `${item.label} · ${item.mw} мВт`
        })),
        rule.power,
        value => {
          rule.power = Number(value);
          updateOutputs();
        }
      );
    } else {
      power = element("input");
      power.type = "number";
      power.min = "1";
      power.step = "1";
      power.value = rule.power;

      power.addEventListener("input", () => {
        rule.power = power.valueAsNumber;
        updateOutputs();
      });
    }

    fields.append(labeledControl("Мощность / уровень", power));
  } else {
    const band = createSelect(bandOptions(), rule.band, value => {
      rule.band = Number(value);
      rule.channel = Math.min(
        rule.channel,
        getBands()[rule.band - 1].frequencies.length
      );

      // Обновляем только зависимый список, не пересоздавая поле с фокусом.
      fillSelect(channel, channelOptions(rule.band), rule.channel);
      updateOutputs();
    });

    const channel = createSelect(
      channelOptions(rule.band),
      rule.channel,
      value => {
        rule.channel = Number(value);
        updateOutputs();
      }
    );

    fields.append(
      labeledControl("Band", band),
      labeledControl("Канал", channel, "channel-field")
    );
  }

  const pwm = element("output", "pwm");
  pwm.dataset.rulePwm = rule.id;

  card.append(fields, pwm);

  return card;
}

function renderRules() {
  for (const [kind, containerId] of [
    ["power", "power-rules"],
    ["channel", "channel-rules"]
  ]) {
    const rules = kind === "power" ? state.powerRules : state.channelRules;
    const container = $(containerId);
    const fragment = document.createDocumentFragment();

    if (!rules.length) {
      fragment.append(element("p", "hint", "Правила не добавлены."));
    }

    rules.forEach((rule, index) => {
      fragment.append(renderRule(rule, index));
    });

    container.replaceChildren(fragment);
  }
}

function activeRules() {
  if (selectedDevice() && !state.enableRules) {
    return [];
  }

  return [...state.powerRules, ...state.channelRules];
}

function validateRules(rules) {
  const errors = [];

  if (!selectedDevice() || state.enableRules) {
    for (const id of ["power-count", "channel-count"]) {
      if (!$(id).validity.valid) {
        errors.push("Укажите корректное целое количество правил.");
        break;
      }
    }
  }

  const profile = currentProfile();
  const bands = getBands();

  for (const rule of rules) {
    if (
      rule.kind === "power" &&
      (
        !Number.isSafeInteger(rule.power) ||
        rule.power < 1 ||
        (profile && rule.power > profile.powers.length)
      )
    ) {
      errors.push("Уровень мощности должен быть корректным целым числом от 1.");
    }

    if (rule.kind === "channel") {
      const band = bands[rule.band - 1];

      if (
        !band ||
        !Number.isInteger(rule.channel) ||
        rule.channel < 1 ||
        rule.channel > band.frequencies.length
      ) {
        errors.push("Проверьте band и номер канала.");
      }
    }
  }

  return [...new Set(errors)];
}

function updateOutputs() {
  const device = selectedDevice();
  const rules = activeRules();
  const pwm = assignPWM(rules);

  pwm.errors = [...validateRules(rules), ...pwm.errors];

  for (const node of document.querySelectorAll("[data-rule-pwm]")) {
    const range = pwm.assigned.get(node.dataset.rulePwm);

    node.classList.toggle("invalid", !range);
    node.textContent = range
      ? `ШИМ ${range.min}–${range.max} мкс · микшер ${range.value}`
      : "Нет корректного ШИМ-диапазона";
  }

  $("cli-errors").hidden = !pwm.errors.length;
  $("cli-errors").textContent = pwm.errors.join("\n");

  $("cli-output").value = buildCLI(state, device, rules, pwm);
  $("copy-cli").disabled = !$("cli-output").value.trim();

  $("dec-settings").hidden = state.lua.switchCount !== 2;
  $("lua-delay").disabled = !state.lua.hold;

  const channels = [...new Set(rules.map(rule => rule.aux + 4))];

  $("lua-summary").textContent =
    `${rules.length} позиций · ` +
    (channels.length ? channels.map(ch => `CH${ch}`).join(", ") : "нет AUX");

  try {
    $("lua-output").value = buildLua(
      state.template,
      state,
      device,
      rules,
      pwm
    );

    $("lua-errors").hidden = true;
    $("copy-lua").disabled = false;
  } catch (error) {
    $("lua-output").value = "";
    $("lua-errors").textContent = error.message;
    $("lua-errors").hidden = false;
    $("copy-lua").disabled = true;
  }
}

function bindLuaSettings() {
  const bindings = [
    ["switch-count", "switchCount", "number"],
    ["inc-switch", "incSwitch", "string"],
    ["inc-state", "incState", "string"],
    ["dec-switch", "decSwitch", "string"],
    ["dec-state", "decState", "string"],
    ["lua-hold", "hold", "boolean"],
    ["lua-delay", "delay", "number"],
    ["lua-voice", "voice", "boolean"]
  ];

  for (const [id, key, type] of bindings) {
    const control = $(id);
    const eventName = control.tagName === "INPUT" ? "input" : "change";
    control.addEventListener(eventName, () => {
      state.lua[key] = type === "boolean"
        ? control.checked
        : type === "number"
          ? Number(control.value)
          : control.value;

      updateOutputs();
    });
  }

  $("lua-template-file").addEventListener("change", async event => {
    const file = event.target.files[0];

    if (!file) {
      return;
    }

    const revision = ++state.templateRevision;

    try {
      const text = await file.text();

      if (revision !== state.templateRevision) {
        return;
      }

      state.template = text;
      $("template-status").textContent = `Загружен файл: ${file.name}`;
    } catch {
      state.template = "";
      $("template-status").textContent = "Не удалось прочитать шаблон.";
    }

    updateOutputs();
  });
}

function bindEvents() {
  setupTabs("[data-page]", tab => showPage(tab.dataset.page));
  setupTabs("[data-lua-page]", tab => showLuaPage(tab.dataset.luaPage));

  $("catalog-search").addEventListener("input", renderCatalog);

  $("transmitter").addEventListener("change", event => {
    selectDevice(event.target.value);
  });

  $("protocol").addEventListener("change", event => {
    state.protocol = event.target.value;
    normalizeRules();
    renderRules();
    updateOutputs();
  });

  $("uart").addEventListener("change", event => {
    state.uart = Number(event.target.value);
    updateOutputs();
  });

  $("base-band").addEventListener("change", event => {
    state.band = Number(event.target.value);
    state.channel = Math.min(
      state.channel,
      getBands()[state.band - 1].frequencies.length
    );

    fillSelect(
      $("base-channel"),
      channelOptions(state.band),
      state.channel
    );

    updateOutputs();
  });

  $("base-channel").addEventListener("change", event => {
    state.channel = Number(event.target.value);
    updateOutputs();
  });

  $("enable-rules").addEventListener("change", event => {
    state.enableRules = event.target.checked;
    updateVisibility();
    updateOutputs();
  });

  bindRuleCount("power-count", "power");
  bindRuleCount("channel-count", "channel");

  $("copy-cli").addEventListener("click", () => {
    copyText($("cli-output").value);
  });

  $("copy-lua").addEventListener("click", () => {
    copyText($("lua-output").value);
  });

  $("open-lua").addEventListener("click", () => {
    updateOutputs();
    $("lua-dialog").showModal();
  });

  $("close-lua").addEventListener("click", () => {
    $("lua-dialog").close();
  });

  bindLuaSettings();
}

async function initialize() {
  fillSelect(
    $("uart"),
    Array.from({ length: 8 }, (_, index) => ({
      value: index + 1,
      label: `UART ${index + 1}`
    })),
    1
  );

  const switches = ["sa", "sb", "sc", "sd", "se", "sf", "sg", "sh"]
    .map(name => ({ value: name, label: name.toUpperCase() }));

  fillSelect($("inc-switch"), switches, state.lua.incSwitch);
  fillSelect($("dec-switch"), switches, state.lua.decSwitch);

  resizeRules("channel", 3);
  renderRules();
  bindEvents();
  updateOutputs();

  // Каталог и Lua загружаются независимо.
  const catalogTask = (async () => {
    try {
      state.devices = await loadCatalog();
      renderDeviceSelector();
      renderCatalog();
    } catch (error) {
      $("catalog-status").textContent =
        `Не удалось загрузить каталог: ${error.message}`;
      $("catalog-count").textContent = "Ошибка загрузки";
    }
  })();

  const templateTask = (async () => {
    const revision = state.templateRevision;

    try {
      const template = await loadLuaTemplate();

      // Не перезаписываем шаблон, если пользователь уже выбрал свой файл.
      if (revision !== state.templateRevision) {
        return;
      }

      state.template = template;
      $("template-status").textContent =
        "Загружен templates/MPX template.lua.";
    } catch (error) {
      if (revision !== state.templateRevision) {
        return;
      }

      $("template-status").textContent = error.message;
    }

    updateOutputs();
  })();
  await Promise.all([catalogTask, templateTask]);
}

initialize();