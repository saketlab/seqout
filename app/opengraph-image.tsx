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
            background: "radial-gradient(circle at center, #6366f140 0%, #8b5cf620 40%, transparent 70%)",
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
            background: "radial-gradient(circle at center, #0ea5e930 0%, #10b98120 40%, transparent 70%)",
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
                <linearGradient id="cylBody" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2e6faa" />
                  <stop offset="8%" stopColor="#3a82be" />
                  <stop offset="30%" stopColor="#5caad8" />
                  <stop offset="50%" stopColor="#78c2ee" />
                  <stop offset="65%" stopColor="#6ab4e4" />
                  <stop offset="85%" stopColor="#3e88c2" />
                  <stop offset="100%" stopColor="#2e70aa" />
                </linearGradient>
                <linearGradient id="topCap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b4def6" />
                  <stop offset="30%" stopColor="#8dcaee" />
                  <stop offset="60%" stopColor="#6fb8e6" />
                  <stop offset="100%" stopColor="#4a9ad0" />
                </linearGradient>
                <linearGradient id="botCap" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#256599" />
                  <stop offset="50%" stopColor="#2a6ea4" />
                  <stop offset="100%" stopColor="#1f5a8c" />
                </linearGradient>
              </defs>
              <path
                d="M10,25 Q50,40 90,25 V75 Q50,90 10,75 Z"
                fill="url(#cylBody)"
              />
              <ellipse cx="50" cy="75" rx="40" ry="15" fill="url(#botCap)" />
              <path
                d="M10,25 Q50,40 90,25 V75 Q50,60 10,75 Z"
                fill="url(#cylBody)"
              />
              <path
                d="M10,55 Q50,70 90,55"
                fill="none"
                stroke="#fff"
                strokeWidth="4"
              />
              <path
                d="M10,40 Q50,55 90,40"
                fill="none"
                stroke="#fff"
                strokeWidth="4"
              />
              <ellipse cx="50" cy="25" rx="40" ry="15" fill="url(#topCap)" />
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
            <div
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
              GEO
            </div>
            <div
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
              SRA
            </div>
            <div
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
              ENA
            </div>
            <div
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
              ArrayExpress
            </div>
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
