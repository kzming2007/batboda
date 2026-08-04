"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/** 핀이 먼 곳으로 뛰면 이 배율로 되돌린다. 필지에 밀착한 채 다른 지역을 보면 아무것도 안 보인다. */
const OVERVIEW_ZOOM = 13;

/** 이 거리(m)를 넘으면 다른 지역으로 옮긴 것으로 본다. 지도 안을 클릭한 정도는 배율을 지킨다. */
const FAR_JUMP_M = 5000;

/** 경계가 들어오면 그 필지가 화면에 꽉 차게 맞춘다. 없으면 핀을 따라간다. */
function MapInteraction({
  lat,
  lng,
  onChange,
  boundary,
}: Pick<FarmMapProps, "lat" | "lng" | "onChange" | "boundary">) {
  const map = useMap();
  const rings = boundary?.rings.length ? boundary.rings : null;
  // 경계 자체가 아니라 필지 식별자에만 반응한다. 같은 필지를 다시 그릴 때 흔들리지 않게 한다.
  const ringKey = rings ? `${boundary!.parcelId}:${rings.length}` : null;

  /**
   * 지금 지도가 무엇을 보여줘야 하는지를 값 하나로 모은다.
   *
   * 경계와 핀을 각각 다른 효과가 맡으면 한 번의 클릭에 둘 다 깨어나 서로 지도를 뺏는다.
   * 무엇을 보여줄지 먼저 정하고 그 결과만 지도에 반영한다.
   */
  const target = ringKey ?? `pin:${lat},${lng}`;
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (applied.current === target) return;
    applied.current = target;

    if (rings) {
      const bounds = latLngBounds(rings.flat());
      if (bounds.isValid()) {
        map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 18, duration: 0.7 });
        return;
      }
    }

    /*
      핀 이동은 애니메이션 없이 즉시 옮긴다.

      `flyTo`는 requestAnimationFrame으로 도는데, 프레임이 끊기면 비행이 중간에 멈추고
      지도는 출발한 자리에 남는다. 그러면 다음 클릭에서야 도착한 것처럼 보인다.
      실제로 `대관령 → 다른 지역`이 한 박자씩 밀린다는 보고가 있었다.
      대표 농지 버튼은 목적지가 분명한 이동이라 날아가는 그림이 필요하지 않다.
    */
    const zoom = map.distance(map.getCenter(), [lat, lng]) > FAR_JUMP_M
      ? OVERVIEW_ZOOM
      : map.getZoom();
    map.setView([lat, lng], zoom, { animate: false });
  }, [target, rings, lat, lng, map]);

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
