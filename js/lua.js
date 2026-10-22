export async function loadLuaTemplate() {
  const url = new URL("../templates/MPX template.lua", import.meta.url);
  const response = await fetch(url, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(
      "Шаблон не найден. Поместите MPX template.lua в templates " +
      "или загрузите файл в окне Lua."
    );
  }

  return response.text();
}

function table(values) {
  return `{ ${values.join(", ")} }`;
}

function switchValue(id, state) {
  return `{ id = "${id}", state = "${state}" }`;
}

/**
 * Ожидается формат шаблона из задания:
 * один изменяемый параметр на строке.
 *
 * Запятые, отступы, комментарии и остальные строки сохраняются.
 */
function patchTemplate(template, replacements) {
  let result = template;

  for (const [key, value] of Object.entries(replacements)) {
    const expression = new RegExp(
      `^([\\t ]*)${key}[\\t ]*=[\\t ]*([^\\r\\n]*)(\\r?)$`,
      "gm"
    );

    let matches = 0;

    result = result.replace(expression, (_, indent, tail, carriage) => {
      matches++;

      const commentIndex = tail.indexOf("--");
      const oldValue = commentIndex >= 0
        ? tail.slice(0, commentIndex)
        : tail;

      const comment = commentIndex >= 0
        ? ` ${tail.slice(commentIndex)}`
        : "";

      const comma = oldValue.trimEnd().endsWith(",") ? "," : "";

      return `${indent}${key} = ${value}${comma}${comment}${carriage}`;
    });

    if (matches !== 1) {
      throw new Error(
        `Параметр ${key}: найдено строк ${matches}, ожидается одна. ` +
        "Проверьте формат оригинального шаблона."
      );
    }
  }

  return result;
}

export function buildLua(template, state, device, rules, pwm) {
  if (!template) {
    throw new Error("Загрузите оригинальный MPX Lua-шаблон.");
  }

  if (!rules.length) {
    throw new Error("Добавьте хотя бы одно активное VTX-правило.");
  }

  if (pwm.errors.length) {
    throw new Error(pwm.errors.join("\n"));
  }

  const settings = state.lua;

  if (!Number.isFinite(settings.delay) || settings.delay <= 0) {
    throw new Error("Задержка автошага должна быть больше нуля.");
  }

  if (
    settings.switchCount === 2 &&
    settings.incSwitch === settings.decSwitch &&
    settings.incState === settings.decState
  ) {
    throw new Error(
      "Для шага +1 и −1 нельзя использовать одинаковый переключатель " +
      "в одинаковом положении."
    );
  }

  const profile = device?.config.profiles[state.protocol];

  const powers = rules.map(rule => {
    if (rule.kind !== "power") {
      return 0;
    }

    // При известной модели — мощность в мВт.
    // Без модели — номер уровня мощности.
    return profile
      ? profile.powers[rule.power - 1].mw
      : rule.power;
  });

  const replacements = {
    POSITIONS: String(rules.length),
    CHANNELS: table(rules.map(rule => rule.aux + 4)),
    VALUES: table(rules.map(rule => pwm.assigned.get(rule.id).value)),
    FREQUENCIES: table(rules.map(() => 0)),
    POWERS: table(powers),

    INC_SWITCH: switchValue(settings.incSwitch, settings.incState),

    DEC_SWITCH: settings.switchCount === 2
      ? switchValue(settings.decSwitch, settings.decState)
      : "nil",

    HOLD: String(settings.hold),
    DELAY: String(settings.delay),
    VOICE: String(settings.voice)
  };

  return patchTemplate(template, replacements);
}
