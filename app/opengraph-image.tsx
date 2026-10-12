import { ImageResponse } from "next/og";

export const alt = "Dependency Pulse: weekly release digest";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fbfaf7", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#17191c" />
            <path d="M5 17h6l3-7 4 13 3-6h6" fill="none" stroke="#fbfaf7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#17191c" }}>Dependency Pulse</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: "#17191c", lineHeight: 1.1, maxWidth: 980 }}>The releases that matter, every Monday, in five minutes.</div>
          <div style={{ display: "flex", gap: 16, fontSize: 30 }}>
            <div style={{ color: "#b0241c", background: "#fdecea", padding: "8px 20px", borderRadius: 999 }}>Act now</div>
            <div style={{ color: "#85500a", background: "#fff4dc", padding: "8px 20px", borderRadius: 999 }}>Review</div>
            <div style={{ color: "#474c54", background: "#f3f1ec", padding: "8px 20px", borderRadius: 999 }}>FYI</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
