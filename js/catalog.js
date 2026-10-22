const ROOT = new URL("../vtx_catalog/", import.meta.url);

async function readJSON(url) {
  const response = await fetch(url, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function validateConfig(config) {
  if (!Array.isArray(config.bands) || !config.bands.length) {
    throw new Error("В конфигурации отсутствуют bands.");
  }

  const channelCount = config.bands[0].frequencies?.length;

  if (!channelCount) {
    throw new Error("Не указаны частоты каналов.");
  }

  for (const band of config.bands) {
    if (
      !/^[A-Z0-9_]{1,8}$/i.test(band.name) ||
      !/^[A-Z]$/i.test(band.letter) ||
      !Array.isArray(band.frequencies) ||
      band.frequencies.length !== channelCount ||
      !band.frequencies.every(
        value => Number.isInteger(value) && value > 0
      )
    ) {
      throw new Error(
        "Некорректный band: проверьте название, букву и частоты. " +
        "Количество каналов во всех bands должно совпадать."
      );
    }
  }

  const profiles = config.profiles;

  if (!profiles || !profiles[config.default_protocol]) {
    throw new Error("Не найден профиль default_protocol.");
  }

  for (const [name, profile] of Object.entries(profiles)) {
    if (!["IRC Tramp", "SmartAudio"].includes(name)) {
      throw new Error(`Неподдерживаемый протокол: ${name}`);
    }

    if (!Array.isArray(profile.powers) || !profile.powers.length) {
      throw new Error(`У профиля ${name} отсутствуют мощности.`);
    }

    for (const power of profile.powers) {
      if (
        !Number.isInteger(power.value) ||
        power.value < 0 ||
        !Number.isFinite(power.mw) ||
        power.mw < 0 ||
        !/^[A-Z0-9_.-]{1,8}$/i.test(String(power.label))
      ) {
        throw new Error(`Некорректный уровень мощности у ${name}.`);
      }
    }
  }

  return config;
}

export async function loadCatalog() {
  const manifest = await readJSON(new URL("index.json", ROOT));

  if (!Array.isArray(manifest)) {
    throw new Error("vtx_catalog/index.json должен содержать массив папок.");
  }

  return Promise.all(manifest.map(async folder => {
    if (
      typeof folder !== "string" ||
      !folder ||
      folder === "." ||
      folder === ".." ||
      /[/\\]/.test(folder)
    ) {
      throw new Error("Некорректное название папки в каталоге.");
    }

    const base = new URL(`${encodeURIComponent(folder)}/`, ROOT);
    const file = name => new URL(encodeURIComponent(name), base).href;

    let description = { "Название": folder };
    let descriptionError = "";

    try {
      description = await readJSON(file("описание.json"));

      if (
        !description ||
        typeof description !== "object" ||
        Array.isArray(description)
      ) {
        throw new Error("Ожидается JSON-объект.");
      }
    } catch (error) {
      description = { "Название": folder };
      descriptionError = `Описание недоступно: ${error.message}`;
    }

    let config = null;
    let configError = "";

    try {
      config = validateConfig(await readJSON(file("vtx конфиг.json")));
    } catch (error) {
      configError = `Конфигурация недоступна: ${error.message}`;
    }

    return {
      id: folder,
      name: String(description["Название"] || folder),
      description,
      descriptionError,
      config,
      configError,
      image: file("фото.webp")
    };
  }));
}
