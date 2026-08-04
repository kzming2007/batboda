"use client";

import { useEffect, useMemo, useState } from "react";
import { divIcon, latLngBounds, type LatLngExpression } from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { ParcelBoundary } from "@/types/domain";

type FarmMapProps = {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  /** 확정한 필지의 경계. 없으면 그리지 않는다. */
  boundary?: ParcelBoundary | null;
  /** 후보를 찾은 반경. 어디서 후보가 나왔는지 보여준다. */
  searchRadiusM?: number | null;
};

/** 경계가 들어오면 그 필지가 화면에 꽉 차게 맞춘다. 없으면 핀을 따라간다. */
function MapInteraction({
  lat,
  lng,
  onChange,
  boundary,
}: Pick<FarmMapProps, "lat" | "lng" | "onChange" | "boundary">) {
  const map = useMap();
  const ringKey = boundary?.rings.length ? `${boundary.parcelId}:${boundary.rings.length}` : null;

  useEffect(() => {
    if (!boundary || boundary.rings.length === 0) return;
    const bounds = latLngBounds(boundary.rings.flat());
    if (!bounds.isValid()) return;
    map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 18, duration: 0.7 });
    // 경계 자체가 아니라 필지 식별자에만 반응한다. 같은 필지를 다시 그릴 때 흔들리지 않게 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringKey, map]);

  useEffect(() => {
    if (boundary && boundary.rings.length > 0) return;
    map.flyTo([lat, lng], map.getZoom(), { duration: 0.7 });
  }, [lat, lng, map, boundary]);

  useMapEvents({
    click(event) {
      onChange(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export default function FarmMap({
  lat,
  lng,
  onChange,
  boundary = null,
  searchRadiusM = null,
}: FarmMapProps) {
  const center: LatLngExpression = [lat, lng];
  const hasBoundary = Boolean(boundary && boundary.rings.length > 0);
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
        {searchRadiusM && !hasBoundary && (
          <Circle
            center={center}
            radius={searchRadiusM}
            pathOptions={{ color: "#6d7b73", weight: 1, dashArray: "4 4", fillOpacity: 0.04 }}
          />
        )}
        {hasBoundary && (
          <Polygon
            positions={boundary!.rings}
            pathOptions={{ color: "#204d34", weight: 2, fillColor: "#356b49", fillOpacity: 0.28 }}
          />
        )}
        <Marker position={center} icon={markerIcon} />
        <MapInteraction lat={lat} lng={lng} onChange={onChange} boundary={boundary} />
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
