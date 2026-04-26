import { useEffect, useState } from "react";

const cache = new Map();

function InlineSVG({ src, color, size = 16, className = "" }) {
  const [svg, setSvg] = useState(cache.get(src) || null);

  useEffect(() => {
    if (cache.has(src)) {
      setSvg(cache.get(src));
      return;
    }
    fetch(src)
      .then(r => r.text())
      .then(text => {
        const cleaned = text
          .replace(/\swidth="[^"]*"/g, "")
          .replace(/\sheight="[^"]*"/g, "");
        cache.set(src, cleaned);
        setSvg(cleaned);
      })
      .catch(() => {});
  }, [src]);

  if (!svg) return <span style={{ width: size, height: size, display: "inline-block" }} />;

  return (
    <span
      className={className}
      style={{ color, width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function SettingsIcon({ color, size = 18 }) {
  return <InlineSVG src="/settings.svg" color={color} size={size} />;
}

export function LocalIcon({ color, size = 16 }) {
  return <InlineSVG src="/local.svg" color={color} size={size} />;
}

export function AIIcon({ color, size = 16 }) {
  return <InlineSVG src="/ai.svg" color={color} size={size} />;
}

export function OnlineIcon({ color, size = 16 }) {
  return <InlineSVG src="/online.svg" color={color} size={size} />;
}
