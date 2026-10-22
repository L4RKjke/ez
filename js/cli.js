const SERIAL_FUNCTION = {
  "SmartAudio": 2048,
  "IRC Tramp": 4096
};

export function buildCLI(state, device, rules, pwm) {
  if (pwm.errors.length) {
    return "";
  }

  const lines = [];

  if (device) {
    const config = device.config;
    const profile = config.profiles[state.protocol];

    lines.push(
      "# ezvtx — by l4",
      "# UART number -> serial identifier assumes UART1 = 0.",
      "# Verify mapping and existing port functions before applying.",
      `serial ${state.uart - 1} ${SERIAL_FUNCTION[state.protocol]} 115200 57600 0 115200`,
      "",
      "# VTX table",
      `vtxtable bands ${config.bands.length}`,
      `vtxtable channels ${config.bands[0].frequencies.length}`
    );

    config.bands.forEach((band, index) => {
      lines.push(
        `vtxtable band ${index + 1} ${band.name} ${band.letter} CUSTOM ` +
        band.frequencies.join(" ")
      );
    });

    lines.push(
      `vtxtable powerlevels ${profile.powers.length}`,
      `vtxtable powervalues ${profile.powers.map(p => p.value).join(" ")}`,
      `vtxtable powerlabels ${profile.powers.map(p => p.label).join(" ")}`,
      "",
      "# Initial settings",
      `set vtx_band = ${state.band}`,
      `set vtx_channel = ${state.channel}`,
      "set vtx_power = 1"
    );
  }

  if (rules.length) {
    if (lines.length) {
      lines.push("");
    }

    lines.push("# VTX Configuration");

    rules.forEach((rule, index) => {
      const range = pwm.assigned.get(rule.id);

      const band = rule.kind === "channel" ? rule.band : 0;
      const channel = rule.kind === "channel" ? rule.channel : 0;
      const power = rule.kind === "power" ? rule.power : 0;

      // Betaflight: AUX1 имеет индекс 0, AUX8 — индекс 7.
      lines.push(
        `vtx ${index} ${rule.aux - 1} ${band} ${channel} ${power} ` +
        `${range.min} ${range.max}`
      );
    });
  }

  return lines.join("\n");
}
