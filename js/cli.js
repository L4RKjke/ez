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
