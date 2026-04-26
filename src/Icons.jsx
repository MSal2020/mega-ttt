function MaskIcon({ src, color, size = 16 }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: color || "currentColor",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

export function SettingsIcon({ color, size = 18 }) {
  return <MaskIcon src="/settings.svg" color={color} size={size} />;
}

export function LocalIcon({ color, size = 16 }) {
  return <MaskIcon src="/local.svg" color={color} size={size} />;
}

export function AIIcon({ color, size = 16 }) {
  return <MaskIcon src="/ai.svg" color={color} size={size} />;
}

export function OnlineIcon({ color, size = 16 }) {
  return <MaskIcon src="/online.svg" color={color} size={size} />;
}
