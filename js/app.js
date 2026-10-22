import { loadCatalog, renderCatalog } from "./catalog.js";
import { initConfigurator } from "./configurator.js";

const $ = id => document.getElementById(id);

const tabs = [...document.querySelectorAll("[data-tab]")];

let toastTimer;

function notify(message) {
  const toast = $("toast");

  clearTimeout(toastTimer);

  toast.textContent = message;
  toast.hidden = false;

  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function switchTab(name, focus = false) {
  for (const tab of tabs) {
    const active = tab.dataset.tab === name;

    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;

    if (active && focus) {
      tab.focus();
    }
  }

  $("catalog-panel").hidden = name !== "catalog";
  $("config-panel").hidden = name !== "config";
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
  });

  tab.addEventListener("keydown", event => {
    let nextIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    switchTab(tabs[nextIndex].dataset.tab, true);
  });
});

// LUA: пока только пустое модальное окно.
const luaDialog = $("lua-dialog");

$("lua-button").addEventListener("click", () => {
  luaDialog.showModal();
});

$("close-lua").addEventListener("click", () => {
  luaDialog.close();
});

luaDialog.addEventListener("click", event => {
  const rect = luaDialog.getBoundingClientRect();

  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;

  if (event.target === luaDialog && outside) {
    luaDialog.close();
  }
});

// Копирование CLI.
$("copy-cli").addEventListener("click", async () => {
  const output = $("cli-output");

  try {
    await navigator.clipboard.writeText(output.value);
    notify("CLI скопирован");
  } catch {
    // Резервный вариант для браузеров без Clipboard API.
    output.focus();
    output.select();

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    notify(
      copied
        ? "CLI скопирован"
        : "Текст выделен. Нажмите Ctrl+C или ⌘C."
    );
  }
});

async function start() {
  let devices = [];
  let loadError = "";

  try {
    devices = await loadCatalog();
  } catch (error) {
    console.error(error);
    loadError =
      "Каталог не загружен. Проверьте index.json и запуск через HTTP-сервер.";
  }

  const configurator = initConfigurator(devices);

  $("catalog-count").textContent = String(devices.length);

  function openConfiguration(id) {
    configurator.selectDevice(id);
    switchTab("config", true);

    $("config-panel").scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start"
    });
  }

  function updateCatalog() {
    const query = $("catalog-search").value.trim().toLocaleLowerCase("ru");

    const filtered = devices.filter(device =>
      device.name.toLocaleLowerCase("ru").includes(query)
    );

    renderCatalog(
      filtered,
      $("catalog-grid"),
      openConfiguration
    );

    $("catalog-empty").hidden = filtered.length > 0;

    $("catalog-empty").textContent = loadError
      ? "Каталог недоступен. Конфигурация правил без модели продолжает работать."
      : devices.length === 0
        ? "Каталог пока пуст. Добавьте передатчики и обновите index.json."
        : "По вашему запросу ничего не найдено.";

    $("catalog-status").textContent = loadError ||
      `Показано ${filtered.length} из ${devices.length}`;
  }
  $("catalog-search").addEventListener("input", updateCatalog);

  updateCatalog();
}

start().catch(error => {
  console.error(error);
  notify("Ошибка инициализации сайта. Подробности — в консоли браузера.");
});
