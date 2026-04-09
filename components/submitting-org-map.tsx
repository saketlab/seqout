"use client";

import { getLeafletPopupTheme } from "@/utils/chart-theme";
import "leaflet/dist/leaflet.css";
import { useTheme } from "next-themes";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { CenterInfo } from "./submitting-org-panel";

const LIGHT_TILES =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
const DARK_TILES =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";

type Props = {
  markers: CenterInfo[];
};

export default function SubmittingOrgMap({ markers }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const tileUrl = isDark ? DARK_TILES : LIGHT_TILES;
  const popupTheme = getLeafletPopupTheme(isDark);

  const center: [number, number] = [
    markers[0].latitude!,
    markers[0].longitude!,
  ];

  return (
    <MapContainer
      center={center}
      zoom={3}
      style={{
        height: "100%",
        minHeight: "300px",
        width: "100%",
        borderRadius: "8px",
      }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url={tileUrl}
      />
      {markers.map((m, i) => {
        const lines: string[] = [];
        if (m.organization) lines.push(`<strong>${m.organization}</strong>`);
        if (m.department) lines.push(m.department);
        if (m.place_name) lines.push(m.place_name);
        const location = [m.city, m.state, m.country]
          .filter(Boolean)
          .join(", ");
        if (location) lines.push(location);
        if (m.postcode) lines.push(`Postal code: ${m.postcode}`);
        if (m.formatted_address) lines.push(m.formatted_address);
        lines.push(
          `<span style="color:${popupTheme.link}">` +
            `${m.latitude!.toFixed(6)}, ${m.longitude!.toFixed(6)}</span>`,
        );
        return (
          <CircleMarker
            key={i}
            center={[m.latitude!, m.longitude!]}
            radius={8}
            pathOptions={{
              fillColor: popupTheme.markerFill,
              fillOpacity: 0.9,
              color: popupTheme.markerBorder,
              weight: 2,
            }}
          >
            <Popup>
              <div
                style={{ fontSize: "13px", lineHeight: "1.5" }}
                dangerouslySetInnerHTML={{ __html: lines.join("<br/>") }}
              />
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
