// Список карточек для дальнейшего использования.
const vtxCards = [];

const catalogUrl = new URL("./vtx_catalog/", document.baseURI);

// Названия обязательных файлов.
const CONFIG_FILE = "vtx конфиг.json";
const DESCRIPTION_FILE = "описание.json";

async function loadJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.json();
}

async function loadVtxCard(folder) {
  const folderUrl = new URL(
    `${encodeURIComponent(folder)}/`,
    catalogUrl
  );

  // Запрашиваем только два обязательных файла.
  const [config, description] = await Promise.all([
    loadJson(new URL(encodeURIComponent(CONFIG_FILE), folderUrl)),
    loadJson(new URL(encodeURIComponent(DESCRIPTION_FILE), folderUrl))
  ]);

  // Оба файла должны содержать JSON-объекты.
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    !description ||
    typeof description !== "object" ||
    Array.isArray(description)
  ) {
    throw new Error("Конфиг и описание должны содержать JSON-объекты");
  }

  return {
    id: folder,
    name: description["Название"] ?? folder,
    config,
    description,

    // Только адрес: фото не загружаем и наличие не проверяем.
    photo: new URL(encodeURIComponent("фото.webp"), folderUrl).href
  };
}

async function loadVtxCatalog() {
  const folders = await loadJson(new URL("index.json", catalogUrl));

  if (
    !Array.isArray(folders) ||
    !folders.every(
      folder => typeof folder === "string" && folder.trim().length > 0
    )
  ) {
    throw new Error("index.json должен содержать массив названий папок");
  }

  const uniqueFolders = [...new Set(folders)];

  // Ошибка в одной папке не мешает загрузке остальных.
  const results = await Promise.allSettled(
    uniqueFolders.map(loadVtxCard)
  );

  vtxCards.length = 0;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      vtxCards.push(result.value);
    } else {
      console.warn(
        `Папка "${uniqueFolders[index]}" пропущена:`,
        result.reason.message
      );
    }
  });

  return vtxCards;
}

// Дождитесь этого Promise перед использованием списка.
const vtxCardsReady = loadVtxCatalog();

const configurationVtxSelect = document.getElementById("configuration-vtx");
const configurationVtxStatus = document.getElementById(
  "configuration-vtx-status"
);

vtxCardsReady
  .then((cards) => {
    const fragment = document.createDocumentFragment();

    cards.forEach((card) => {
      const option = document.createElement("option");

      option.value = card.id;
      option.textContent = card.name;

      fragment.append(option);
    });

    configurationVtxSelect.append(fragment);

    configurationVtxStatus.textContent = cards.length
      ? "Выберите передатчик из списка."
      : "Нет доступных передатчиков.";
  })
  .catch((error) => {
    console.error("Ошибка загрузки списка передатчиков:", error);

    configurationVtxStatus.textContent =
      "Не удалось загрузить список передатчиков.";

    configurationVtxStatus.classList.add("vtx-selection__hint--error");
  })
  .finally(() => {
    configurationVtxSelect.disabled = false;
  });
