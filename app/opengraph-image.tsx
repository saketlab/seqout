import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          fontFamily: "-apple-system, SF Pro Display, system-ui, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-20%",
            right: "-10%",
            width: "60%",
            height: "120%",
            background:
              "radial-gradient(circle at center, #6366f140 0%, #8b5cf620 40%, transparent 70%)",
            filter: "blur(60px)",
            display: "flex",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: "-20%",
            left: "-10%",
            width: "50%",
            height: "100%",
            background:
              "radial-gradient(circle at center, #0ea5e930 0%, #10b98120 40%, transparent 70%)",
            filter: "blur(60px)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            zIndex: 1,
            padding: "80px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginBottom: 8,
            }}
          >
            <svg
              width="100"
              height="100"
              viewBox="0 0 100 100"
              style={{ display: "flex" }}
            >
              <defs>
                <linearGradient id="iconGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5BB8F5" />
                  <stop offset="100%" stopColor="#2E86D0" />
                </linearGradient>
              </defs>
              <circle
                cx="42"
                cy="42"
                r="32"
                fill="none"
                stroke="url(#iconGrad)"
                strokeWidth="7"
              />
              <line
                x1="66"
                y1="66"
                x2="92"
                y2="92"
                stroke="#2E86D0"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 26,36 C 34,46 50,46 58,36"
                fill="none"
                stroke="#5BB8F5"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M 26,48 C 34,38 50,38 58,48"
                fill="none"
                stroke="#89d4f7"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <line
                x1="33"
                y1="39"
                x2="33"
                y2="45"
                stroke="#5BB8F5"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.6"
              />
              <line
                x1="42"
                y1="37"
                x2="42"
                y2="47"
                stroke="#5BB8F5"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.6"
              />
              <line
                x1="51"
                y1="39"
                x2="51"
                y2="45"
                stroke="#5BB8F5"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.6"
              />
            </svg>
            <div
              style={{
                fontSize: 88,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                display: "flex",
              }}
            >
              <span style={{ color: "#236598" }}>seq</span>
              <span style={{ color: "#1a1a1a" }}>out</span>
            </div>
          </div>

          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: "#666666",
              textAlign: "center",
              lineHeight: 1.4,
              maxWidth: "700px",
              display: "flex",
            }}
          >
            Explore sequencing datasets with unified metadata
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 32,
              alignItems: "center",
            }}
          >
            {["GEO", "SRA", "ENA", "ArrayExpress"].map((db) => (
              <div
                key={db}
                style={{
                  display: "flex",
                  padding: "10px 20px",
                  borderRadius: "20px",
                  fontSize: 18,
                  fontWeight: 600,
                  backgroundColor: "#f5f5f7",
                  color: "#1a1a1a",
                }}
              >
                {db}
              </div>
            ))}
          </div>

          <div
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: "#999999",
              marginTop: 48,
              display: "flex",
            }}
          >
            seqout.org
          </div>
        </div>
      </div>
    ),
    size,
  );
}
