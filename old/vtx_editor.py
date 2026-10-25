from __future__ import annotations

import copy
import io
import json
import os
import re
import shlex
import shutil
import sys
import tempfile
from pathlib import Path

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from tkinter.scrolledtext import ScrolledText

from PIL import Image, ImageOps, ImageTk


BASE = (
    Path(sys.executable).resolve().parent
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent
)

CONFIG_FILE = "vtx конфиг.json"
DESCRIPTION_FILE = "описание.json"
IMAGE_FILES = ("фото.webp", "распиновка.webp")

DESCRIPTION_TEMPLATE = {
    "Название": "",
    "Диапазон": "",
    "Каналы": "",
    "Протокол": "",
    "Мощность": "",
    "Кулер": "",
    "Крепление": "",
    "Коннектор": "",
    "Основной цвет": "",
    "Дополнительный цвет": "",
    "Индикация": "",
}


def empty_config():
    return {
        "default_protocol": "IRC Tramp",
        "bands": [],
        "profiles": {
            "IRC Tramp": {
                "powers": []
            }
        },
    }


def json_bytes(value):
    return (
        json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")


def atomic_write(path: Path, data: bytes):
    """Записывает один файл через временный файл и os.replace."""
    if path.is_symlink():
        raise ValueError(f"Запись через символическую ссылку запрещена: {path}")

    fd, temporary = tempfile.mkstemp(
        prefix=".vtx-editor-",
        suffix=".tmp",
        dir=path.parent,
    )

    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())

        os.replace(temporary, path)

    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def is_link_or_junction(path: Path):
    if path.is_symlink():
        return True

    # os.path.isjunction есть в Python 3.12+.
    checker = getattr(os.path, "isjunction", None)
    if checker and checker(path):
        return True

    # Проверка reparse point также работает на Windows с Python 3.11.
    if os.name == "nt":
        try:
            attributes = getattr(path.lstat(), "st_file_attributes", 0)
            return bool(attributes & 0x400)
        except OSError:
            return True

    return False


def check_folder_name(name):
    if not name or name in {".", ".."}:
        raise ValueError("Имя папки не должно быть пустым.")

    if len(name) > 120:
        raise ValueError("Имя папки слишком длинное: максимум 120 символов.")

    if re.search(r'[<>:"/\\|?*\x00-\x1f]', name):
        raise ValueError("Имя содержит недопустимые символы Windows.")

    if name.endswith((" ", ".")):
        raise ValueError("Имя не должно заканчиваться пробелом или точкой.")

    reserved = {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }

    if name.split(".")[0].upper() in reserved:
        raise ValueError("Это зарезервированное имя Windows.")

    if name.casefold() == "index.json":
        raise ValueError("Имя index.json зарезервировано.")


def require_int(value, name, low=0, high=65535):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(
            f"{name}: требуется целое число от {low} до {high}."
        )


def validate_config(config):
    """Проверяет поддерживаемую структуру перед показом или сохранением."""
    if not isinstance(config, dict):
        raise ValueError("Конфигурация должна быть JSON-объектом.")

    bands = config.get("bands")
    profiles = config.get("profiles")
    default = config.get("default_protocol")

    if not isinstance(bands, list) or len(bands) > 8:
        raise ValueError("bands должен содержать от 0 до 8 диапазонов.")

    channel_count = None

    for index, band in enumerate(bands, 1):
        if not isinstance(band, dict):
            raise ValueError(f"Диапазон {index}: ожидается объект.")

        if not re.fullmatch(r"[A-Za-z0-9_]{1,8}", str(band.get("name", ""))):
            raise ValueError(
                f"Диапазон {index}: имя должно содержать 1–8 "
                "латинских букв, цифр или символов подчёркивания."
            )

        if not re.fullmatch(r"[A-Za-z]", str(band.get("letter", ""))):
            raise ValueError(f"Диапазон {index}: letter — одна латинская буква.")

        frequencies = band.get("frequencies")

        if not isinstance(frequencies, list) or not 1 <= len(frequencies) <= 8:
            raise ValueError(
                f"Диапазон {index}: требуется от 1 до 8 частот."
            )

        if channel_count is None:
            channel_count = len(frequencies)

        if len(frequencies) != channel_count:
            raise ValueError(
                "Количество каналов должно быть одинаковым во всех диапазонах."
            )

        for frequency in frequencies:
            require_int(frequency, "Частота")

        if "factory" in band and type(band["factory"]) is not bool:
            raise ValueError("Поле factory должно быть true или false.")

    if not isinstance(profiles, dict) or not profiles:
        raise ValueError("profiles должен содержать хотя бы один профиль.")

    if default not in profiles:
        raise ValueError("default_protocol должен указывать на существующий профиль.")

    for protocol, profile in profiles.items():
        if not isinstance(protocol, str) or not protocol.strip():
            raise ValueError("Имя протокола не должно быть пустым.")

        if not isinstance(profile, dict):
            raise ValueError(f"Профиль {protocol}: ожидается объект.")

        powers = profile.get("powers")

        if not isinstance(powers, list) or len(powers) > 8:
            raise ValueError(
                f"Профиль {protocol}: требуется от 0 до 8 уровней мощности."
            )

        for power in powers:
            if not isinstance(power, dict):
                raise ValueError("Уровень мощности должен быть объектом.")

            label = power.get("label")

            if not isinstance(label, str) or not re.fullmatch(
                r"[A-Za-z0-9_.-]{1,3}", label
            ):
                raise ValueError(
                    "Метка мощности должна содержать 1–3 символа: "
                    "латиница, цифры, точка, дефис или подчёркивание."
                )

            require_int(power.get("value"), "Значение мощности value")
            require_int(power.get("mw"), "Мощность mw", 0, 1_000_000)


def config_to_cli(config, protocol):
    bands = config["bands"]
    powers = config["profiles"][protocol]["powers"]
    channels = len(bands[0]["frequencies"]) if bands else 0

    lines = [
        "# Таблица VTX. Команды не отправляются на полётный контроллер.",
        "# Диапазоны общие для всех профилей; мощности — для выбранного.",
        "",
        f"vtxtable bands {len(bands)}",
        f"vtxtable channels {channels}",
    ]

    for index, band in enumerate(bands, 1):
        kind = "FACTORY" if band.get("factory", False) else "CUSTOM"
        frequencies = " ".join(map(str, band["frequencies"]))

        lines.append(
            f"vtxtable band {index} "
            f"{band['name']} {band['letter']} {kind} {frequencies}"
        )

    lines.extend([
        "",
        f"vtxtable powerlevels {len(powers)}",
        "vtxtable powervalues" + (
            " " + " ".join(str(power["value"]) for power in powers)
            if powers else ""
        ),
        "vtxtable powerlabels" + (
            " " + " ".join(power["label"] for power in powers)
            if powers else ""
        ),
        "",
    ])

    return "\n".join(lines)


def cli_to_config(text, mw_text, original, protocol, default_protocol):
    """
    Разбирает только vtxtable и необязательную строку save.
    Прочие CLI-команды отклоняются, чтобы не потерять их незаметно.
    """
    statements = {}
    bands = {}

    for line_number, raw in enumerate(text.splitlines(), 1):
        try:
            parts = shlex.split(raw, comments=True)
        except ValueError as exc:
            raise ValueError(f"Строка {line_number}: {exc}") from exc

        if not parts:
            continue

        if parts == ["save"]:
            continue

        if len(parts) < 2 or parts[0].lower() != "vtxtable":
            raise ValueError(
                f"Строка {line_number}: поддерживаются только команды vtxtable."
            )

        command = parts[1].lower()
        arguments = parts[2:]

        if command == "band":
            if len(arguments) < 5:
                raise ValueError(
                    f"Строка {line_number}: ожидается "
                    "vtxtable band N NAME LETTER CUSTOM|FACTORY частоты..."
                )

            try:
                number = int(arguments[0])
                frequencies = list(map(int, arguments[4:]))
            except ValueError as exc:
                raise ValueError(
                    f"Строка {line_number}: номер и частоты должны быть целыми."
                ) from exc

            if not 1 <= number <= 8 or number in bands:
                raise ValueError(
                    f"Строка {line_number}: неверный или повторный номер диапазона."
                )

            kind = arguments[3].upper()

            if kind not in {"CUSTOM", "FACTORY"}:
                raise ValueError(
                    f"Строка {line_number}: требуется CUSTOM или FACTORY."
                )

            bands[number] = {
                "name": arguments[1],
                "letter": arguments[2],
                "frequencies": frequencies,
                "factory": kind == "FACTORY",
            }

        elif command in {
            "bands", "channels", "powerlevels", "powervalues", "powerlabels"
        }:
            if command in statements:
                raise ValueError(
                    f"Строка {line_number}: повторная команда {command}."
                )

            statements[command] = arguments

        else:
            raise ValueError(
                f"Строка {line_number}: команда vtxtable {command} не поддерживается."
            )

    required = {
        "bands", "channels", "powerlevels", "powervalues", "powerlabels"
    }

    missing = required - statements.keys()

    if missing:
        raise ValueError(
            "Не хватает команд: " + ", ".join(sorted(missing))
        )

    def one_number(name):
        values = statements[name]

        if len(values) != 1:
            raise ValueError(f"vtxtable {name}: требуется одно число.")

        try:
            return int(values[0])
        except ValueError as exc:
            raise ValueError(f"vtxtable {name}: требуется целое число.") from exc

    band_count = one_number("bands")
    channel_count = one_number("channels")
    power_count = one_number("powerlevels")

    if not 0 <= band_count <= 8:
        raise ValueError("Количество диапазонов: от 0 до 8.")

    if band_count == 0:
        if channel_count != 0:
            raise ValueError("Для пустой таблицы укажите channels 0.")
    elif not 1 <= channel_count <= 8:
        raise ValueError("Количество каналов: от 1 до 8.")

    if not 0 <= power_count <= 8:
        raise ValueError("Количество уровней мощности: от 0 до 8.")

    if set(bands) != set(range(1, band_count + 1)):
        raise ValueError(
            "Номера диапазонов должны идти подряд от 1 до значения bands."
        )

    for band in bands.values():
        if len(band["frequencies"]) != channel_count:
            raise ValueError(
                "Число частот в каждом диапазоне должно совпадать с channels."
            )

    try:
        values = list(map(int, statements["powervalues"]))
        milliwatts = [
            int(value)
            for value in re.split(r"[\s,;]+", mw_text.strip())
            if value
        ]
    except ValueError as exc:
        raise ValueError(
            "powervalues и значения мВт должны быть целыми числами."
        ) from exc

    labels = statements["powerlabels"]

    if not (len(values) == len(labels) == len(milliwatts) == power_count):
        raise ValueError(
            "Количество powervalues, powerlabels и значений мВт "
            "должно совпадать с powerlevels."
        )

    result = copy.deepcopy(original)

    # Сохраняем дополнительные поля диапазонов по их номеру.
    new_bands = []

    for index in range(band_count):
        old = (
            copy.deepcopy(original["bands"][index])
            if index < len(original["bands"]) else {}
        )
        new = bands[index + 1]

        old.update({
            "name": new["name"],
            "letter": new["letter"],
            "frequencies": new["frequencies"],
        })

        # Для CUSTOM необязательное поле не добавляется без необходимости.
        if new["factory"] or "factory" in old:
            old["factory"] = new["factory"]

        new_bands.append(old)

    result["bands"] = new_bands

    old_powers = result["profiles"][protocol]["powers"]
    new_powers = []

    for index in range(power_count):
        power = (
            copy.deepcopy(old_powers[index])
            if index < len(old_powers) else {}
        )

        power.update({
            "label": labels[index],
            "value": values[index],
            "mw": milliwatts[index],
        })
        new_powers.append(power)

    result["profiles"][protocol]["powers"] = new_powers
    result["default_protocol"] = default_protocol

    validate_config(result)
    return result


class VTXEditor(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Редактор каталога VTX")
        self.geometry("1200x820")
        self.minsize(940, 680)

        self.catalog = (BASE / "vtx_catalog").resolve()
        self.catalog.mkdir(parents=True, exist_ok=True)

        self.names = []
        self.current = None
        self.config = empty_config()
        self.active_protocol = "IRC Tramp"

        self.images = {name: None for name in IMAGE_FILES}
        self.image_changed = set()
        self.image_refs = {}

        self.dirty = False
        self.loading = False
        self.selecting = False

        self.protocol_var = tk.StringVar()
        self.default_var = tk.StringVar()
        self.mw_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Выберите карточку или создайте новую.")
        self.path_var = tk.StringVar(value=str(self.catalog))
        self.card_var = tk.StringVar(value="Карточка не выбрана")

        self.build_ui()

        self.mw_var.trace_add("write", self.mark_dirty)
        self.default_var.trace_add("write", self.mark_dirty)

        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.bind("<Control-s>", lambda event: self.save_card())

        self.refresh_list()

    def build_ui(self):
        toolbar = ttk.Frame(self, padding=8)
        toolbar.pack(fill="x")

        ttk.Button(
            toolbar, text="Открыть каталог", command=self.choose_catalog
        ).pack(side="left")

        ttk.Button(
            toolbar, text="Обновить список", command=self.refresh_clicked
        ).pack(side="left", padx=6)

        ttk.Button(
            toolbar, text="Добавить карточку", command=self.new_card
        ).pack(side="left")

        self.save_button = ttk.Button(
            toolbar, text="Сохранить · Ctrl+S", command=self.save_card
        )
        self.save_button.pack(side="left", padx=6)

        self.delete_button = ttk.Button(
            toolbar, text="Удалить карточку", command=self.delete_card
        )
        self.delete_button.pack(side="right")

        ttk.Label(
            self, textvariable=self.path_var, padding=(10, 0, 10, 8)
        ).pack(fill="x")

        body = ttk.Panedwindow(self, orient="horizontal")
        body.pack(fill="both", expand=True, padx=8)

        left = ttk.Frame(body, width=310)
        right = ttk.Frame(body)

        body.add(left, weight=1)
        body.add(right, weight=4)

        ttk.Label(left, text="Передатчики — папки каталога").pack(
            anchor="w", pady=(0, 6)
        )

        list_frame = ttk.Frame(left)
        list_frame.pack(fill="both", expand=True)

        self.listbox = tk.Listbox(
            list_frame,
            exportselection=False,
            width=37,
            font=("Segoe UI", 10),
        )
        scrollbar = ttk.Scrollbar(
            list_frame, orient="vertical", command=self.listbox.yview
        )
        self.listbox.configure(yscrollcommand=scrollbar.set)

        self.listbox.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.listbox.bind("<<ListboxSelect>>", self.on_select)

        ttk.Label(
            right, textvariable=self.card_var, padding=(8, 0, 0, 8)
        ).pack(anchor="w")

        self.notebook = ttk.Notebook(right)
        self.notebook.pack(fill="both", expand=True, padx=(8, 0))

        cli_tab = ttk.Frame(self.notebook, padding=10)
        description_tab = ttk.Frame(self.notebook, padding=10)

        self.notebook.add(cli_tab, text="VTX · CLI")
        self.notebook.add(description_tab, text="Описание")

        controls = ttk.Frame(cli_tab)
        controls.pack(fill="x")

        ttk.Label(controls, text="Редактируемый профиль:").grid(
            row=0, column=0, sticky="w", padx=(0, 8), pady=4
        )

        self.protocol_combo = ttk.Combobox(
            controls,
            textvariable=self.protocol_var,
            state="readonly",
            width=24,
        )
        self.protocol_combo.grid(row=0, column=1, sticky="w")
        self.protocol_combo.bind(
            "<<ComboboxSelected>>", self.switch_profile
        )

        ttk.Button(
            controls, text="+ Профиль", command=self.add_profile
        ).grid(row=0, column=2, padx=8)

        ttk.Label(controls, text="Протокол по умолчанию:").grid(
            row=1, column=0, sticky="w", padx=(0, 8), pady=4
        )

        self.default_combo = ttk.Combobox(
            controls,
            textvariable=self.default_var,
            state="readonly",
            width=24,
        )
        self.default_combo.grid(row=1, column=1, sticky="w")

        ttk.Label(
            cli_tab,
            text=(
                "Мощности, мВт — в порядке powerlabels, через пробел "
                "(например: 25 400 1000 2500):"
            ),
            wraplength=750,
        ).pack(anchor="w", pady=(10, 4))

        ttk.Entry(cli_tab, textvariable=self.mw_var).pack(fill="x")

        self.cli_text = ScrolledText(
            cli_tab,
            font=("Consolas", 11),
            bg="#17191c",
            fg="#c7efc4",
            insertbackground="white",
            wrap="none",
            undo=True,
        )
        self.cli_text.pack(fill="both", expand=True, pady=(10, 0))
        self.cli_text.bind("<<Modified>>", self.on_text_modified)

        ttk.Label(
            cli_tab,
            text=(
                "Сохраняется JSON, а не текст CLI. "
                "Команда save допускается, но не записывается в конфигурацию. "
                "Другие команды, кроме vtxtable, не поддерживаются."
            ),
            wraplength=750,
        ).pack(anchor="w", pady=(8, 0))

        ttk.Label(
            description_tab,
            text=(
                "JSON-объект описания. Можно добавлять собственные поля. "
                "Отсутствующий файл будет создан при сохранении."
            ),
            wraplength=750,
        ).pack(anchor="w", pady=(0, 8))

        self.description_text = ScrolledText(
            description_tab,
            font=("Consolas", 11),
            wrap="word",
            undo=True,
        )
        self.description_text.pack(fill="both", expand=True)
        self.description_text.bind("<<Modified>>", self.on_text_modified)

        self.image_labels = {}

        for filename, title in (
            ("фото.webp", "Фото"),
            ("распиновка.webp", "Распиновка"),
        ):
            tab = ttk.Frame(self.notebook, padding=10)
            self.notebook.add(tab, text=title)

            buttons = ttk.Frame(tab)
            buttons.pack(fill="x")

            ttk.Button(
                buttons,
                text="Добавить / заменить изображение",
                command=lambda name=filename: self.import_image(name),
            ).pack(side="left")

            ttk.Button(
                buttons,
                text="Удалить изображение",
                command=lambda name=filename: self.remove_image(name),
            ).pack(side="left", padx=8)

            ttk.Label(
                tab,
                text=(
                    f"Файл: {filename}. Изменения применяются после сохранения."
                ),
            ).pack(anchor="w", pady=10)

            label = ttk.Label(tab, text="Изображение отсутствует", anchor="center")
            label.pack(fill="both", expand=True)
            self.image_labels[filename] = label

        ttk.Label(
            self,
            textvariable=self.status_var,
            padding=10,
            wraplength=1150,
        ).pack(fill="x")

        self.update_title()

    def update_title(self):
        name = self.current or "Карточка не выбрана"
        self.card_var.set(name + ("  • несохранённые изменения" if self.dirty else ""))

        enabled = "normal" if self.current else "disabled"
        self.save_button.configure(state=enabled)
        self.delete_button.configure(state=enabled)

    def mark_dirty(self, *_):
        if self.loading or not self.current:
            return

        self.dirty = True
        self.update_title()

    def on_text_modified(self, event):
        widget = event.widget

        if widget.edit_modified():
            widget.edit_modified(False)
            self.mark_dirty()

    def set_text(self, widget, text):
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.edit_reset()
        widget.edit_modified(False)

    def card_path(self, name=None):
        name = self.current if name is None else name

        if not name or Path(name).name != name:
            raise ValueError("Некорректное имя карточки.")

        path = self.catalog / name

        if is_link_or_junction(path):
            raise ValueError("Папки-ссылки и junction не поддерживаются.")

        if path.resolve().parent != self.catalog.resolve():
            raise ValueError("Папка находится за пределами каталога.")

        if not path.is_dir():
            raise ValueError(f"Папка карточки отсутствует: {name}")

        return path

    def scan_names(self):
        return sorted(
            [
                path.name
                for path in self.catalog.iterdir()
                if path.is_dir() and not is_link_or_junction(path)
            ],
            key=str.casefold,
        )

    def update_index(self):
        names = self.scan_names()
        atomic_write(self.catalog / "index.json", json_bytes(names))
        return names

    def refresh_list(self):
        try:
            self.names = self.update_index()
        except Exception as exc:
            messagebox.showerror("Ошибка каталога", str(exc), parent=self)
            return False

        self.selecting = True
        try:
            self.listbox.delete(0, "end")

            for name in self.names:
                self.listbox.insert("end", name)

            if self.current in self.names:
                index = self.names.index(self.current)
                self.listbox.selection_set(index)
                self.listbox.see(index)
        finally:
            self.selecting = False

        return True

    def restore_selection(self):
        self.selecting = True
        try:
            self.listbox.selection_clear(0, "end")
            if self.current in self.names:
                self.listbox.selection_set(self.names.index(self.current))
        finally:
            self.selecting = False

    def confirm_leave(self):
        if not self.dirty:
            return True

        answer = messagebox.askyesnocancel(
            "Несохранённые изменения",
            "Сохранить изменения текущей карточки?",
            parent=self,
        )

        if answer is None:
            return False

        if answer:
            return self.save_card()

        return True
    def on_select(self, _event=None):
        if self.selecting:
            return

        selection = self.listbox.curselection()
        if not selection:
            return

        name = self.names[selection[0]]

        if name == self.current:
            return

        if not self.confirm_leave():
            self.restore_selection()
            return

        if not self.load_card(name):
            self.restore_selection()

    def read_json(self, path, fallback):
        if not path.exists():
            return copy.deepcopy(fallback)

        if path.is_symlink():
            raise ValueError(f"Файл-ссылка не поддерживается: {path.name}")

        with path.open("r", encoding="utf-8-sig") as stream:
            return json.load(stream)

    def load_card(self, name):
        try:
            path = self.card_path(name)

            config = self.read_json(path / CONFIG_FILE, empty_config())
            validate_config(config)

            description = self.read_json(
                path / DESCRIPTION_FILE,
                DESCRIPTION_TEMPLATE,
            )

            if not isinstance(description, dict):
                raise ValueError("Описание должно быть JSON-объектом.")

            images = {}
            for filename in IMAGE_FILES:
                image_path = path / filename

                if image_path.is_symlink():
                    raise ValueError(f"Файл-ссылка не поддерживается: {filename}")

                images[filename] = (
                    image_path.read_bytes() if image_path.exists() else None
                )

        except Exception as exc:
            messagebox.showerror(
                "Не удалось открыть карточку",
                f"{name}\n\n{exc}\n\n"
                "Повреждённые JSON-файлы автоматически не перезаписываются.",
                parent=self,
            )
            return False

        self.loading = True
        try:
            self.current = name
            self.config = config
            self.active_protocol = config["default_protocol"]
            self.images = images
            self.image_changed.clear()

            self.update_profile_controls()
            self.default_var.set(config["default_protocol"])
            self.render_profile()

            self.set_text(
                self.description_text,
                json.dumps(description, ensure_ascii=False, indent=2),
            )

            for filename in IMAGE_FILES:
                self.show_image(filename)

            missing = [
                filename
                for filename in (CONFIG_FILE, DESCRIPTION_FILE, *IMAGE_FILES)
                if not (path / filename).exists()
            ]

            self.status_var.set(
                "Карточка открыта."
                if not missing
                else "Отсутствуют: " + ", ".join(missing)
                + ". Редактирование и добавление доступны."
            )

            self.dirty = False
            self.update_title()

        finally:
            self.loading = False

        self.restore_selection()
        return True

    def clear_card(self):
        self.loading = True
        try:
            self.current = None
            self.dirty = False
            self.config = empty_config()
            self.active_protocol = "IRC Tramp"

            self.protocol_var.set("")
            self.default_var.set("")
            self.mw_var.set("")
            self.protocol_combo["values"] = ()
            self.default_combo["values"] = ()

            self.set_text(self.cli_text, "")
            self.set_text(self.description_text, "")

            self.images = {name: None for name in IMAGE_FILES}
            self.image_changed.clear()

            for filename in IMAGE_FILES:
                self.show_image(filename)

            self.update_title()
        finally:
            self.loading = False

    def update_profile_controls(self):
        values = list(self.config["profiles"])
        self.protocol_combo["values"] = values
        self.default_combo["values"] = values
    def render_profile(self):
        previous_loading = self.loading
        self.loading = True
        try:
            self.protocol_var.set(self.active_protocol)

            self.set_text(
                self.cli_text,
                config_to_cli(self.config, self.active_protocol),
            )

            powers = self.config["profiles"][self.active_protocol]["powers"]
            self.mw_var.set(" ".join(str(power["mw"]) for power in powers))
        finally:
            self.loading = previous_loading

    def collect_config(self):
        return cli_to_config(
            self.cli_text.get("1.0", "end-1c"),
            self.mw_var.get(),
            self.config,
            self.active_protocol,
            self.default_var.get(),
        )

    def switch_profile(self, _event=None):
        if self.loading or not self.current:
            return

        selected = self.protocol_var.get()

        if selected == self.active_protocol:
            return

        try:
            self.config = self.collect_config()
        except Exception as exc:
            self.protocol_var.set(self.active_protocol)
            messagebox.showerror(
                "Ошибка текущего профиля", str(exc), parent=self
            )
            return

        self.active_protocol = selected
        self.render_profile()

    def add_profile(self):
        if not self.current:
            return

        name = simpledialog.askstring(
            "Новый профиль",
            "Название протокола, например SmartAudio 2.1:",
            parent=self,
        )

        if name is None:
            return

        name = name.strip()

        if not name:
            return

        if name in self.config["profiles"]:
            messagebox.showerror(
                "Ошибка", "Такой профиль уже существует.", parent=self
            )
            return

        try:
            self.config = self.collect_config()
        except Exception as exc:
            messagebox.showerror("Ошибка CLI", str(exc), parent=self)
            return

        self.config["profiles"][name] = {"powers": []}
        self.active_protocol = name
        self.update_profile_controls()
        self.render_profile()
        self.mark_dirty()

    def show_image(self, filename):
        label = self.image_labels[filename]
        data = self.images[filename]

        self.image_refs.pop(filename, None)

        if data is None:
            label.configure(image="", text="Изображение отсутствует")
            return

        try:
            with Image.open(io.BytesIO(data)) as source:
                source.seek(0)
                image = ImageOps.exif_transpose(source).convert("RGBA")
                image.thumbnail((720, 460), Image.Resampling.LANCZOS)

            photo = ImageTk.PhotoImage(image)
            self.image_refs[filename] = photo
            label.configure(image=photo, text="")

        except Exception as exc:
            label.configure(
                image="",
                text=f"Не удалось показать изображение:\n{exc}\n\n"
                     "Его можно заменить или удалить.",
            )

    def import_image(self, filename):
        if not self.current:
            return

        selected = filedialog.askopenfilename(
            parent=self,
            title=f"Выбрать {filename}",
            filetypes=[
                ("Изображения", "*.webp *.png *.jpg *.jpeg *.bmp *.tif *.tiff"),
                ("Все файлы", "*.*"),
            ],
        )

        if not selected:
            return

        try:
            with Image.open(selected) as source:
                source.seek(0)
                image = ImageOps.exif_transpose(source).convert("RGBA")

                output = io.BytesIO()
                # Lossless сохраняет читаемость текста на схемах распиновки.
                image.save(output, format="WEBP", lossless=True)

            self.images[filename] = output.getvalue()
            self.image_changed.add(filename)
            self.show_image(filename)
            self.mark_dirty()
        except Exception as exc:
            messagebox.showerror("Ошибка изображения", str(exc), parent=self)

    def remove_image(self, filename):
        if not self.current:
            return

        self.images[filename] = None
        self.image_changed.add(filename)
        self.show_image(filename)
        self.mark_dirty()

    def save_card(self):
        if not self.current:
            return False

        try:
            path = self.card_path()
            config = self.collect_config()

            description = json.loads(
                self.description_text.get("1.0", "end-1c")
            )

            if not isinstance(description, dict):
                raise ValueError("Описание должно быть JSON-объектом.")

            # Проверяем всё до начала записи.
            config_data = json_bytes(config)
            description_data = json_bytes(description)

            for filename in (CONFIG_FILE, DESCRIPTION_FILE, *IMAGE_FILES):
                target = path / filename
                if target.is_symlink():
                    raise ValueError(
                        f"Операция с файлом-ссылкой запрещена: {filename}"
                    )

            atomic_write(path / CONFIG_FILE, config_data)
            atomic_write(path / DESCRIPTION_FILE, description_data)

            for filename in self.image_changed:
                target = path / filename
                data = self.images[filename]

                if data is None:
                    target.unlink(missing_ok=True)
                else:
                    atomic_write(target, data)

            self.update_index()

        except Exception as exc:
            messagebox.showerror(
                "Ошибка сохранения",
                f"{exc}\n\nЕсли ошибка связана с диском или правами доступа, "
                "часть файлов могла уже сохраниться. "
                "Исправьте причину и повторите сохранение.",
                parent=self,
            )
            return False

        self.config = config
        self.image_changed.clear()
        self.dirty = False
        self.update_title()

        self.status_var.set(
            f"Сохранено: {self.current}. Файл index.json обновлён."
        )
        return True

    def new_card(self):
        if not self.confirm_leave():
            return

        numbers = []

        for name in self.scan_names():
            match = re.match(r"^(\d+)_", name)
            if match:
                numbers.append(int(match.group(1)))

        suggested = f"{max(numbers, default=0) + 1:03d}_New_VTX"

        name = simpledialog.askstring(
            "Добавление карточки",
            "Имя новой папки:",
            initialvalue=suggested,
            parent=self,
        )

        if name is None:
            return

        try:
            check_folder_name(name)
            path = self.catalog / name

            if any(
                existing.casefold() == name.casefold()
                for existing in self.scan_names()
            ):
                raise ValueError("Папка с таким именем уже существует.")

            path.mkdir()

        except Exception as exc:
            messagebox.showerror("Ошибка добавления", str(exc), parent=self)
            return

        if not self.refresh_list():
            self.status_var.set(
                f"Папка {name} создана, но index.json обновить не удалось."
            )
            return

        self.load_card(name)
        self.status_var.set(
            "Карточка создана и добавлена в index.json. "
            "Заполните данные и нажмите «Сохранить»."
        )

    def delete_card(self):
        if not self.current:
            return

        name = self.current

        if not messagebox.askyesno(
            "Удалить карточку",
            f"Удалить карточку «{name}»?\n\n"
            "Вся её папка, вложенные папки и файлы будут удалены "
            "без перемещения в корзину.\n"
            "Несохранённые изменения этой карточки будут отброшены.",
            icon="warning",
            parent=self,
        ):
            return

        try:
            path = self.card_path()
            shutil.rmtree(path)
        except Exception as exc:
            # rmtree при ошибке может успеть удалить часть файлов.
            self.refresh_list()
            messagebox.showerror(
                "Ошибка удаления",
                f"{exc}\n\nПроверьте папку: удаление могло выполниться частично.",
                parent=self,
            )
            return

        self.clear_card()

        if self.refresh_list():
            self.status_var.set(
                f"Карточка {name} удалена. Файл index.json обновлён."
            )
        else:
            self.status_var.set(
                "Папка удалена, но index.json обновить не удалось. "
                "Исправьте ошибку доступа и обновите список."
            )

    def refresh_clicked(self):
        if not self.confirm_leave():
            return

        name = self.current

        if not self.refresh_list():
            return

        if name in self.names:
            self.load_card(name)
        else:
            self.clear_card()
            self.status_var.set("Список обновлён. Файл index.json пересоздан.")

    def choose_catalog(self):
        if not self.confirm_leave():
            return

        selected = filedialog.askdirectory(
            parent=self,
            title="Выберите папку vtx_catalog",
            initialdir=str(self.catalog),
        )

        if not selected:
            return

        self.clear_card()
        self.catalog = Path(selected).resolve()
        self.path_var.set(str(self.catalog))

        if self.refresh_list():
            self.status_var.set("Каталог открыт. Выберите карточку.")

    def on_close(self):
        if self.confirm_leave():
            self.destroy()


if __name__ == "__main__":
    VTXEditor().mainloop()
