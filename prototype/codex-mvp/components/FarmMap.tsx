"use client";

import { useEffect, useMemo, useState } from "react";
import { divIcon, type LatLngExpression } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type FarmMapProps = {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
};

function MapInteraction({ lat, lng, onChange }: FarmMapProps) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom(), { duration: 0.7 });
  }, [lat, lng, map]);

  useMapEvents({
    click(event) {
      onChange(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export default function FarmMap({ lat, lng, onChange }: FarmMapProps) {
  const center: LatLngExpression = [lat, lng];
  const [tileState, setTileState] = useState<"loading" | "ready" | "error">("loading");
  const [tileAttempt, setTileAttempt] = useState(0);
  const markerIcon = useMemo(
    () =>
      divIcon({
        className: "farm-map-marker",
        html: '<span class="farm-map-marker__pulse"></span><span class="farm-map-marker__core"></span>',
        iconSize: [36, 36],
        iconAnchor: [18, 32],
      }),
    [],
  );

  return (
    <div className="farm-map-shell">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        className="farm-map"
        aria-label="분석할 농지 위치 선택 지도"
      >
        <TileLayer
          key={tileAttempt}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            load: () => setTileState((current) => current === "error" ? current : "ready"),
            tileerror: () => setTileState("error"),
          }}
        />
        <Marker position={center} icon={markerIcon} />
        <MapInteraction lat={lat} lng={lng} onChange={onChange} />
      </MapContainer>
      {tileState === "loading" && (
        <div className="map-network-state" role="status">지도 배경을 불러오는 중입니다.</div>
      )}
      {tileState === "error" && (
        <div className="map-network-state error" role="alert">
          <strong>지도 배경을 불러오지 못했습니다.</strong>
          <span>아래 대표 농지 버튼과 표시 좌표로도 분석할 수 있습니다.</span>
          <button
            type="button"
            onClick={() => {
              setTileState("loading");
              setTileAttempt((current) => current + 1);
            }}
          >
            지도 다시 불러오기
          </button>
        </div>
      )}
    </div>
  );
}
