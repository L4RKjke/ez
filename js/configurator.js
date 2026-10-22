import { renderPhoto, renderSpecs } from "./catalog.js";
import { generateCLI, pwmRange, MAX_RULES } from "./cli.js";

const $ = id => document.getElementById(id);

const GENERIC_BANDS = ["A", "B", "E", "F", "R"].map(letter => ({
  name: `BAND_${letter}`,
  letter,
  frequencies: Array(8).fill(null)
}));

const GENERIC_POWERS = Array.from({ length: 8 }, (_, index) => ({
  label: String(index + 1),
  value: index + 1,
  mw: null
}));

function fillSelect(select, entries, selected) {
  select.replaceChildren(
    ...entries.map(([value, label]) => new Option(label, String(value)))
  );

  select.value = String(selected);
}

function createSelectField(labelText, entries, selected, onChange) {
  const label = document.createElement("label");
  label.className = "field";

  const caption = document.createElement("span");
  caption.textContent = labelText;

  const select = document.createElement("select");
  fillSelect(select, entries, selected);

  select.addEventListener("change", () => {
    onChange(Number(select.value));
  });

  label.append(caption, select);

  return label;
}

export function initConfigurator(devices) {
  const state = {
    device: null,
    uart: 1,
    band: 1,
    channel: 1,

    rulesEnabled: false,

    powerAux: 1,
    channelAux: 2,

    powerRules: [],
    channelRules: []
  };

  const elements = {
    device: $("device-select"),
    devicePanel: $("device-panel"),
    protocol: $("protocol"),
    uart: $("uart"),
    band: $("band"),
    channel: $("channel"),
    frequency: $("frequency"),

    enabled: $("enable-rules"),
    rulesPanel: $("rules-panel"),

    powerAux: $("power-aux"),
    channelAux: $("channel-aux"),
    powerCount: $("power-count"),
    channelCount: $("channel-count"),

    powerRules: $("power-rules"),
    channelRules: $("channel-rules"),

    output: $("cli-output")
  };

  function bands() {
    return state.device?.config.bands ?? GENERIC_BANDS;
  }

  function powers() {
    return state.device?.config.powers ?? GENERIC_POWERS;
  }

  function bandEntries() {
    return bands().map((band, index) => [
      index + 1,
      `${band.letter} · ${band.name}`
    ]);
  }

  function channelEntries(bandIndex) {
    return bands()[bandIndex - 1].frequencies.map((frequency, index) => [
      index + 1,
      frequency === null
        ? `Канал ${index + 1}`
        : `${index + 1} · ${frequency} МГц`
    ]);
  }

  function powerEntries() {
    return powers().map((power, index) => {
      if (!state.device) {
        return [index + 1, `Уровень ${index + 1}`];
      }

      const label = power.mw === null
        ? power.label
        : `${power.mw} мВт · ${power.label}`;

      return [index + 1, label];
    });
  }

  function updateCLI() {
    const text = generateCLI(state);

    elements.output.value = text;

    $("cli-line-count").textContent =
      `${text.split("\n").length} строк`;
  }

  function updateVisibility() {
    elements.devicePanel.hidden = !state.device;
    elements.rulesPanel.hidden =
      Boolean(state.device) && !state.rulesEnabled;
  }

  function updateMainChannels() {
    fillSelect(
      elements.channel,
      channelEntries(state.band),
      state.channel
    );

    elements.frequency.value = state.device
      ? `${
          bands()[state.band - 1].frequencies[state.channel - 1]
        } МГц`
      : "";
  }

  function updateMainSettings() {
    if (!state.device) {
      return;
    }

    elements.protocol.value = state.device.config.protocol;
    $("device-protocol-badge").textContent =
      state.device.config.protocol;

    $("device-name").textContent = state.device.name;

    renderPhoto($("device-photo"), state.device);

    renderSpecs(
      $("device-description"),
      state.device.description,
      ["Протокол", "Мощность", "Диапазон", "Каналы"]
    );

    fillSelect(elements.band, bandEntries(), state.band);
    updateMainChannels();
  }

  function defaultChannelRule(index) {
    const all = [];

    bands().forEach((band, bandIndex) => {
      band.frequencies.forEach((_, channelIndex) => {
        all.push({
          band: bandIndex + 1,
          channel: channelIndex + 1
        });
      });
    });

    return { ...all[index % all.length] };
  }

  function resizeRules(kind, count) {
    const key = kind === "power" ? "powerRules" : "channelRules";

    while (state[key].length < count) {
      const index = state[key].length;

      state[key].push(
        kind === "power"
          ? { power: index % powers().length + 1 }
          : defaultChannelRule(index)
      );
    }

    state[key].length = count;
  }

  function normalizeRules() {
    state.powerRules.forEach(rule => {
      rule.power = Math.min(Math.max(rule.power, 1), powers().length);
    });

    state.channelRules.forEach(rule => {
      rule.band = Math.min(Math.max(rule.band, 1), bands().length);

      const channelCount = bands()[rule.band - 1].frequencies.length;

      rule.channel = Math.min(Math.max(rule.channel, 1), channelCount);
    });
  }

  function ensureDifferentAux() {
    if (
      state.powerRules.length &&
      state.channelRules.length &&
      state.powerAux === state.channelAux
    ) {
      state.channelAux = state.powerAux === 1 ? 2 : 1;
    }
  }

  function updateAuxOptions() {
    ensureDifferentAux();

    const bothActive =
      state.powerRules.length > 0 &&
      state.channelRules.length > 0;

    for (const option of elements.powerAux.options) {
      option.disabled =
        bothActive && Number(option.value) === state.channelAux;
    }

    for (const option of elements.channelAux.options) {
      option.disabled =
        bothActive && Number(option.value) === state.powerAux;
    }

    elements.powerAux.value = String(state.powerAux);
    elements.channelAux.value = String(state.channelAux);
  }

  function makeRuleRow(index, count, channelRule = false) {
    const row = document.createElement("div");
    row.className = `rule-row${channelRule ? " channel-rule" : ""}`;

    const number = document.createElement("span");
    number.className = "rule-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const pwm = document.createElement("span");
    pwm.className = "pwm";

    const range = pwmRange(index, count);

    pwm.textContent = `${range.start}–${range.end} мкс`;
    pwm.title = "Нижняя граница включена, верхняя — не включена";

    row.append(number);

    return { row, pwm };
  }

  function renderPowerRules() {
    elements.powerRules.replaceChildren();

    state.powerRules.forEach((rule, index) => {
      const { row, pwm } = makeRuleRow(
        index,
        state.powerRules.length
      );

      const field = createSelectField(
        "Мощность",
        powerEntries(),
        rule.power,
        value => {
          rule.power = value;
          updateCLI();
        }
      );

      row.append(field, pwm);
      elements.powerRules.append(row);
    });
  }

  function renderChannelRules() {
    elements.channelRules.replaceChildren();

    state.channelRules.forEach((rule, index) => {
      const { row, pwm } = makeRuleRow(
        index,
        state.channelRules.length,
        true
      );

      let channelField;

      const bandField = createSelectField(
        "Band",
        bandEntries(),
        rule.band,
        value => {
          rule.band = value;
          rule.channel = Math.min(
            rule.channel,
            bands()[value - 1].frequencies.length
          );

          fillSelect(
            channelField.querySelector("select"),
            channelEntries(rule.band),
            rule.channel
          );

          updateCLI();
        }
      );

      channelField = createSelectField(
        "Канал",
        channelEntries(rule.band),
        rule.channel,
        value => {
          rule.channel = value;
          updateCLI();
        }
      );

      row.append(bandField, channelField, pwm);
      elements.channelRules.append(row);
    });
  }

  function renderRules() {
    renderPowerRules();
    renderChannelRules();
    updateAuxOptions();
    elements.powerCount.value = String(state.powerRules.length);
    elements.channelCount.value = String(state.channelRules.length);

    elements.powerCount.max = String(
      Math.min(8, MAX_RULES - state.channelRules.length)
    );

    elements.channelCount.max = String(
      MAX_RULES - state.powerRules.length
    );

    $("rules-summary").textContent =
      `${state.powerRules.length + state.channelRules.length}` +
      ` / ${MAX_RULES} правил`;
  }

  function changeCount(kind, input) {
    // Пустое поле допускается во время редактирования.
    if (input.value === "") {
      return;
    }

    const raw = Number(input.value);

    if (!Number.isFinite(raw)) {
      return;
    }

    const otherCount = kind === "power"
      ? state.channelRules.length
      : state.powerRules.length;

    const maximum = Math.min(
      kind === "power" ? 8 : MAX_RULES,
      MAX_RULES - otherCount
    );

    const count = Math.max(0, Math.min(maximum, Math.trunc(raw)));

    resizeRules(kind, count);
    renderRules();
    updateCLI();
  }

  function selectDevice(id) {
    const device = devices.find(item => item.id === id);

    state.device = device?.config ? device : null;

    elements.device.value = state.device?.id ?? "";

    state.band = 1;
    state.channel = 1;

    // Количество правил сохраняется; значения адаптируются к модели.
    state.powerRules = state.powerRules.map((_, index) => ({
      power: index % powers().length + 1
    }));

    state.channelRules = state.channelRules.map((_, index) =>
      defaultChannelRule(index)
    );

    normalizeRules();
    updateVisibility();
    updateMainSettings();
    renderRules();
    updateCLI();
  }

  // Выбор модели.
  for (const device of devices) {
    const option = new Option(
      device.name + (device.config ? "" : " — нет конфигурации"),
      device.id
    );

    option.disabled = !device.config;
    elements.device.append(option);
  }

  // UART1–UART8.
  fillSelect(
    elements.uart,
    Array.from({ length: 8 }, (_, index) => [
      index + 1,
      `UART${index + 1}`
    ]),
    state.uart
  );

  // AUX1–AUX14 соответствуют CH5–CH18.
  const auxEntries = Array.from({ length: 14 }, (_, index) => [
    index + 1,
    `AUX${index + 1} · CH${index + 5}`
  ]);

  fillSelect(elements.powerAux, auxEntries, state.powerAux);
  fillSelect(elements.channelAux, auxEntries, state.channelAux);

  elements.device.addEventListener("change", () => {
    selectDevice(elements.device.value);
  });

  elements.uart.addEventListener("change", () => {
    state.uart = Number(elements.uart.value);
    updateCLI();
  });

  elements.band.addEventListener("change", () => {
    state.band = Number(elements.band.value);
    state.channel = 1;
    updateMainChannels();
    updateCLI();
  });

  elements.channel.addEventListener("change", () => {
    state.channel = Number(elements.channel.value);
    updateMainChannels();
    updateCLI();
  });

  elements.enabled.addEventListener("change", () => {
    state.rulesEnabled = elements.enabled.checked;
    updateVisibility();
    updateCLI();
  });

  elements.powerAux.addEventListener("change", () => {
    state.powerAux = Number(elements.powerAux.value);
    updateAuxOptions();
    updateCLI();
  });

  elements.channelAux.addEventListener("change", () => {
    state.channelAux = Number(elements.channelAux.value);
    updateAuxOptions();
    updateCLI();
  });

  for (const [kind, input] of [
    ["power", elements.powerCount],
    ["channel", elements.channelCount]
  ]) {
    input.addEventListener("input", () => changeCount(kind, input));

    input.addEventListener("blur", () => {
      if (input.value === "") {
        input.value = "0";
      }

      changeCount(kind, input);
    });
  }

  resizeRules("power", 3);
  resizeRules("channel", 3);

  updateVisibility();
  renderRules();
  updateCLI();

  return { selectDevice };
}
