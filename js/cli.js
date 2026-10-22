export const MAX_RULES = 10;

export function pwmRange(index, count) {
  // 900–2100 мкс = 48 шагов по 25 мкс.
  const start = 900 + Math.floor(index * 48 / count) * 25;
  const end = 900 + Math.floor((index + 1) * 48 / count) * 25;

  return { start, end };
}

export function generateCLI(state) {
  const lines = [];
  const config = state.device?.config;

  if (config) {
    const channelCount = Math.max(
      ...config.bands.map(band => band.frequencies.length)
    );

    // Betaflight:
    // FUNCTION_VTX_SMARTAUDIO = 2048
    // FUNCTION_VTX_TRAMP = 8192
    const serialFunction =
      config.protocol === "IRC Tramp" ? 8192 : 2048;

    lines.push(
      "# VTX configuration",
      `# Protocol: ${config.protocol}`,
      `# Verify UART${state.uart} mapping before applying`,
      "",
      `serial ${state.uart - 1} ${serialFunction} 115200 57600 0 115200`,
      "",
      "vtxtable bands 0",
      `vtxtable channels ${channelCount}`,
      `vtxtable bands ${config.bands.length}`
    );

    config.bands.forEach((band, index) => {
      const frequencies = Array.from(
        { length: channelCount },
        (_, channel) => band.frequencies[channel] ?? 0
      );

      lines.push(
        `vtxtable band ${index + 1} ${band.name} ${band.letter} CUSTOM ` +
        frequencies.join(" ")
      );
    });

    lines.push(
      `vtxtable powerlevels ${config.powers.length}`,
      "vtxtable powervalues " +
        config.powers.map(power => power.value).join(" "),
      "vtxtable powerlabels " +
        config.powers.map(power => power.label).join(" "),
      "",
      `set vtx_band = ${state.band}`,
      `set vtx_channel = ${state.channel}`,
      `set vtx_freq = ${
        config.bands[state.band - 1].frequencies[state.channel - 1]
      }`,
      "",
      "# Replace VTX activation rules"
    );
  }

  const rules = [];

  if (!config || state.rulesEnabled) {
    state.powerRules.forEach((rule, index) => {
      const { start, end } = pwmRange(index, state.powerRules.length);

      rules.push({
        aux: state.powerAux,
        band: 0,
        channel: 0,
        power: rule.power,
        start,
        end
      });
    });

    state.channelRules.forEach((rule, index) => {
      const { start, end } = pwmRange(index, state.channelRules.length);

      rules.push({
        aux: state.channelAux,
        band: rule.band,
        channel: rule.channel,
        power: 0,
        start,
        end
      });
    });
  }

  // Все слоты записываются явно, чтобы старые правила не оставались.
  for (let index = 0; index < MAX_RULES; index++) {
    const rule = rules[index];

    if (!rule) {
      lines.push(`vtx ${index} 0 0 0 0 900 900`);
      continue;
    }

    // В CLI AUX индексируется с нуля: AUX1 -> 0.
    lines.push(
      `vtx ${index} ${rule.aux - 1} ` +
      `${rule.band} ${rule.channel} ${rule.power} ` +
      `${rule.start} ${rule.end}`
    );
  }

  return lines.join("\n");
}
