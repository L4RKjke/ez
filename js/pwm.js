export const AUX_COUNT = 14;

/**
 * Не ограничиваем общее количество правил искусственным числом.
 * Но у одного AUX конечное число диапазонов с шагом 25 мкс.
 */
export function assignPWM(rules) {
  const groups = new Map();
  const assigned = new Map();
  const errors = [];

  for (const rule of rules) {
    if (
      !Number.isInteger(rule.aux) ||
      rule.aux < 1 ||
      rule.aux > AUX_COUNT
    ) {
      errors.push(`Правило ${rule.id}: некорректный AUX.`);
      continue;
    }

    if (!groups.has(rule.aux)) {
      groups.set(rule.aux, []);
    }

    groups.get(rule.aux).push(rule);
  }

  for (const [aux, group] of groups) {
    const count = group.length;

    if (count > 48) {
      errors.push(
        `AUX${aux}: ${count} правил. Максимум 48 непересекающихся ` +
        `диапазонов с шагом 25 мкс. Перенесите часть правил на другой AUX.`
      );
      continue;
    }

    // До 42 правил оставляем запас относительно 900 и 2100.
    const start = count <= 42 ? 975 : 900;
    const end = count <= 42 ? 2025 : 2100;
    const slots = (end - start) / 25;

    const boundaries = Array.from(
      { length: count + 1 },
      (_, index) => start + Math.round(index * slots / count) * 25
    );

    group.forEach((rule, index) => {
      const min = boundaries[index];
      const max = boundaries[index + 1];

      // Обычно -100…100 соответствует 1000…2000 мкс.
      // Берём центр интервала, а не край.
      const value = Math.max(
        -100,
        Math.min(100, Math.round(((min + max) / 2 - 1500) / 5))
      );

      const pwm = 1500 + value * 5;

      if (pwm < min || pwm >= max) {
        errors.push(
          `AUX${aux}, позиция ${index + 1}: диапазон ${min}–${max} мкс ` +
          `недостижим микшером -100…100. Используйте другой AUX.`
        );
        return;
      }

      assigned.set(rule.id, { min, max, value, pwm });
    });
  }

  return { assigned, errors };
}
