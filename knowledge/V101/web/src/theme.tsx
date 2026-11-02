import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { api, send } from "./api";

export const DEFAULT_THEME_COLOR = "#6254e8";
export const THEME_PRESETS = [
  { name: "紫蓝", color: DEFAULT_THEME_COLOR },
  { name: "湖蓝", color: "#1967d2" },
  { name: "青碧", color: "#007f86" },
  { name: "翠绿", color: "#00875a" },
  { name: "琥珀", color: "#a85e00" },
  { name: "玫紫", color: "#b23878" },
];
const CACHE_KEY = "nebulaekno.appearance.brand-color";
export const validThemeColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function mix(color: string, target: number, amount: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          parseInt(color.slice(offset, offset + 2), 16) * (1 - amount) +
            target * amount,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// Keep white button labels and colored text readable, even for a pale custom color.
export function readableBrand(color: string) {
  const input = validThemeColor(color)
    ? color.toLowerCase()
    : DEFAULT_THEME_COLOR;
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(input, 0, step / 100);
    const luminance = [1, 3, 5]
      .map((offset) => {
        const v = parseInt(candidate.slice(offset, offset + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    if (1.05 / (luminance + 0.05) >= 4.5) return candidate;
  }
  return input;
}

export function themeVariables(color: string): CSSProperties {
  const primary = readableBrand(color);
  const colors = [0.95, 0.87, 0.72, 0.54, 0.32].map((amount) =>
    mix(primary, 255, amount),
  );
  colors.push(
    mix(primary, 0, 0.08),
    primary,
    mix(primary, 0, 0.18),
    mix(primary, 0, 0.32),
    mix(primary, 0, 0.48),
  );
  return Object.fromEntries([
    ...colors.map((value, i) => [`--td-brand-color-${i + 1}`, value]),
    ["--td-brand-color", primary],
    ["--td-brand-color-hover", colors[5]],
    ["--td-brand-color-active", colors[7]],
    ["--td-brand-color-focus", colors[1]],
    ["--td-brand-color-disabled", colors[2]],
    ["--td-brand-color-light", colors[0]],
    ["--td-brand-color-light-hover", colors[1]],
    ["--td-text-color-brand", primary],
    ["--td-text-color-link", colors[7]],
  ]) as CSSProperties;
}

function cachedColor() {
  try {
    const color = localStorage.getItem(CACHE_KEY);
    if (validThemeColor(color)) return color;
  } catch {
    /* Storage may be disabled; the server remains authoritative. */
  }
  return DEFAULT_THEME_COLOR;
}

const ThemeContext = createContext({
  color: DEFAULT_THEME_COLOR,
  loading: true,
  error: "",
  reload: () => {},
  save: async (_color: string) => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [color, setColor] = useState(cachedColor);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    Object.entries(themeVariables(color)).forEach(([name, value]) =>
      document.documentElement.style.setProperty(name, String(value)),
    );
    try {
      localStorage.setItem(CACHE_KEY, color);
    } catch {
      /* Optional cache. */
    }
  }, [color]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ brand_color: string }>("/settings/appearance", {
      signal: controller.signal,
    })
      .then((settings) => {
        if (controller.signal.aborted) return;
        if (!validThemeColor(settings.brand_color))
          throw new Error("主题颜色格式无效");
        setColor(settings.brand_color.toLowerCase());
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  async function save(next: string) {
    if (!validThemeColor(next)) throw new Error("请选择有效的颜色");
    const result = await send(
      "/settings/appearance",
      { brand_color: next.toLowerCase() },
      "PUT",
    );
    setColor(result.brand_color);
    setError("");
  }
  return (
    <ThemeContext.Provider
      value={{
        color,
        loading,
        error,
        reload: () => setRevision((value) => value + 1),
        save,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
