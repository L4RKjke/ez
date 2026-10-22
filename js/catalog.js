const ROOT = new URL("../vtx_catalog/", import.meta.url);

async function readJSON(url) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function normalizeConfig(raw) {
  const protocol = raw.default_protocol;

  if (!["IRC Tramp", "SmartAudio"].includes(protocol)) {
    throw new Error("Неподдерживаемый default_protocol");
  }

  if (
    !Array.isArray(raw.bands) ||
    raw.bands.length < 1 ||
    raw.bands.length > 8
  ) {
    throw new Error("Конфигурация должна содержать от 1 до 8 диапазонов");
  }

  const bands = raw.bands.map((band, index) => {
    if (
      !Array.isArray(band.frequencies) ||
      band.frequencies.length < 1 ||
      band.frequencies.length > 8 ||
      band.frequencies.some(
        value => !Number.isInteger(value) || value <= 0 || value > 9999
      )
    ) {
      throw new Error(`Некорректные частоты в диапазоне ${index + 1}`);
    }

    const name = String(band.name ?? "").toUpperCase();
    const letter = String(band.letter ?? "").toUpperCase();

    if (!/^[A-Z0-9_]{1,8}$/.test(name) || !/^[A-Z]$/.test(letter)) {
      throw new Error("Некорректное имя или буква диапазона");
    }

    return {
      name,
      letter,
      frequencies: [...band.frequencies]
    };
  });

  const rawPowers = raw.profiles?.[protocol]?.powers;

  if (
    !Array.isArray(rawPowers) ||
    rawPowers.length < 1 ||
    rawPowers.length > 8
  ) {
    throw new Error("Профиль должен содержать от 1 до 8 уровней мощности");
  }

  const powers = rawPowers.map(power => {
    const label = String(power.label ?? "");

    if (
      !/^[a-zA-Z0-9]{1,3}$/.test(label) ||
      !Number.isInteger(power.value) ||
      power.value < 0 ||
      power.value > 65535
    ) {
      throw new Error("Некорректные значения или подписи мощности");
    }

    return {
      label,
      value: power.value,
      mw: Number.isFinite(power.mw) && power.mw >= 0
        ? power.mw
        : null
    };
  });

  return { protocol, bands, powers };
}

async function loadDevice(folder) {
  const directory = new URL(`${encodeURIComponent(folder)}/`, ROOT);

  let description = {};
  let config = null;
  const problems = [];

  try {
    description = await readJSON(new URL("описание.json", directory));

    if (
      !description ||
      typeof description !== "object" ||
      Array.isArray(description)
    ) {
      throw new Error("Ожидался объект");
    }
  } catch {
    description = {};
    problems.push("Не удалось прочитать описание.json.");
  }

  try {
    const rawConfig = await readJSON(
      new URL("vtx конфиг.json", directory)
    );

    config = normalizeConfig(rawConfig);
  } catch (error) {
    problems.push(`Конфигурация недоступна: ${error.message}.`);
  }

  return {
    id: folder,
    name: String(description["Название"] || folder),
    description,
    config,
    photo: new URL("фото.webp", directory).href,
    problem: problems.join(" ")
  };
}

export async function loadCatalog() {
  const folders = await readJSON(new URL("index.json", ROOT));

  if (
    !Array.isArray(folders) ||
    folders.some(
      folder =>
        typeof folder !== "string" ||
        !folder.trim() ||
        folder === "." ||
        folder === ".." ||
        /[\\/]/.test(folder)
    )
  ) {
    throw new Error("index.json должен содержать массив названий папок");
  }

  const devices = await Promise.all(
    [...new Set(folders)].map(loadDevice)
  );

  return devices.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function renderPhoto(container, device) {
  const image = document.createElement("img");

  image.src = device.photo;
  image.alt = device.name;
  image.loading = "lazy";

  image.addEventListener("error", () => {
    const placeholder = document.createElement("span");

    placeholder.className = "photo-placeholder";
    placeholder.textContent = "Фото недоступно";

    container.replaceChildren(placeholder);
  }, { once: true });
  container.replaceChildren(image);
}

export function renderSpecs(container, description, keys = null) {
  container.replaceChildren();

  const entries = keys
    ? keys.map(key => [key, description[key] ?? "—"])
    : Object.entries(description).filter(([key]) => key !== "Название");

  for (const [key, value] of entries) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");

    term.textContent = key;
    detail.textContent = String(value);

    container.append(term, detail);
  }
}

export function renderCatalog(devices, container, onConfigure) {
  container.replaceChildren();

  for (const device of devices) {
    const card = document.createElement("article");
    card.className = "vtx-card";

    const photo = document.createElement("div");
    photo.className = "photo-box";
    renderPhoto(photo, device);

    const title = document.createElement("h3");
    title.textContent = device.name;

    const specs = document.createElement("dl");
    specs.className = "spec-list";
    renderSpecs(specs, device.description);

    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = device.problem;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = "Посмотреть конфигурацию";
    button.disabled = !device.config;

    if (!device.config) {
      button.title = device.problem || "Файл конфигурации отсутствует";
    }

    button.addEventListener("click", () => onConfigure(device.id));

    card.append(photo, title, specs);

    if (device.problem) {
      card.append(note);
    }

    card.append(button);
    container.append(card);
  }
}
