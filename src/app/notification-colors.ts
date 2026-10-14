import {
  providers,
  type NamedNotificationColor,
  type NotificationColor,
  type ProviderDefinition,
  type ServiceConfig,
} from "./providers";

export const notificationColors = [
  "auto",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "red",
  "purple",
  "magenta",
] as const satisfies readonly NotificationColor[];

export interface NotificationColorStyle {
  background: string;
  foreground: string;
}

// Named presets and validated #rrggbb values are the only persisted styles used.
const palette: Record<
  Exclude<NamedNotificationColor, "auto">,
  NotificationColorStyle
> = {
  blue: { background: "#2563c5", foreground: "#ffffff" },
  cyan: { background: "#18a9bd", foreground: "#101318" },
  green: { background: "#2ea96c", foreground: "#101318" },
  amber: { background: "#e6b23f", foreground: "#101318" },
  orange: { background: "#e68a3f", foreground: "#101318" },
  red: { background: "#c73948", foreground: "#ffffff" },
  purple: { background: "#8354c6", foreground: "#ffffff" },
  magenta: { background: "#b7368c", foreground: "#ffffff" },
};

export function normalizeNotificationColor(value: unknown): NotificationColor {
  if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value))
    return value.toLowerCase() as `#${string}`;
  return notificationColors.find((color) => color === value) ?? "auto";
}

export function randomNotificationColor(): NotificationColor {
  const rgb = crypto.getRandomValues(new Uint8Array(3));
  return `#${[...rgb].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function customColorStyle(color: `#${string}`): NotificationColorStyle {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  // Choose the higher WCAG contrast ratio; one of black/white always exceeds 4.5:1.
  const foreground =
    (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
      ? "#000000"
      : "#ffffff";
  return { background: color, foreground };
}

type ServiceNotificationColor = Pick<
  ServiceConfig,
  "provider" | "notificationColor"
>;

export function resolveNotificationColor(
  service: ServiceNotificationColor,
): NotificationColorStyle {
  let color = normalizeNotificationColor(service.notificationColor);
  if (color === "auto") {
    const provider: ProviderDefinition | undefined =
      providers[service.provider];
    color = normalizeNotificationColor(provider?.defaultNotificationColor);
  }
  if (color === "auto")
    return {
      background: "var(--accent)",
      foreground: "var(--accent-foreground)",
    };
  if (color.startsWith("#")) return customColorStyle(color as `#${string}`);
  return palette[color as Exclude<NamedNotificationColor, "auto">];
}

export function applyNotificationColor(
  element: HTMLElement,
  service: ServiceNotificationColor,
): void {
  const color = resolveNotificationColor(service);
  element.style.setProperty("--notification-color", color.background);
  element.style.setProperty("--notification-foreground", color.foreground);
}
