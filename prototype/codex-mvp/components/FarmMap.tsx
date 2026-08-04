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

/**
 * 지도가 보는 곳을 옮긴다.
 *
 * 옮길 이유는 두 가지뿐이다 — **핀이 움직였을 때**와 **다른 필지의 경계가 들어왔을 때**.
 * 둘을 한 값으로 합치면 안 된다. 경계 조회는 시작할 때 이전 경계를 비우는데, 그러면
 * `볼 대상`이 잠깐 핀으로 돌아가 지도가 핀 위치로 되돌아간다. 핀은 움직이지 않았는데도
 * `294-7 → 294-1`이 `평창 대관령 → 294-1`처럼 보이던 원인이다.
 *
 * 그래서 **경계가 사라진 것에는 반응하지 않는다.** 없어졌으면 그냥 그 자리에 머문다.
 */
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

  // 첫 그림은 이미 핀 위치에서 시작하므로 그 값을 적용된 것으로 둔다.
  const appliedPin = useRef(`${lat},${lng}`);

  useEffect(() => {
    const pin = `${lat},${lng}`;
    if (appliedPin.current === pin) return;
    appliedPin.current = pin;

    /*
      핀 이동은 애니메이션 없이 즉시 옮긴다.

      `flyTo`는 requestAnimationFrame으로 도는데, 프레임이 끊기면 비행이 중간에 멈추고
      지도는 출발한 자리에 남는다. 대표 농지 버튼은 목적지가 분명한 이동이라
      날아가는 그림이 필요하지 않다.

      먼 거리를 뛸 때는 배율도 되돌린다. 필지에 밀착한 배율로 다른 지역을 보면 아무것도
      안 보인다. 지도 안을 클릭한 정도는 사용자가 맞춘 배율을 지킨다.
    */
    const zoom = map.distance(map.getCenter(), [lat, lng]) > FAR_JUMP_M
      ? OVERVIEW_ZOOM
      : map.getZoom();
    map.setView([lat, lng], zoom, { animate: false });
  }, [lat, lng, map]);

  const appliedRing = useRef<string | null>(null);

  useEffect(() => {
    // 경계가 없는 상태는 지도를 옮길 이유가 아니다. 조회 중에도 보던 자리를 지킨다.
    if (!rings || !ringKey) return;
    if (appliedRing.current === ringKey) return;
    appliedRing.current = ringKey;

    const bounds = latLngBounds(rings.flat());
    if (!bounds.isValid()) return;
    /*
      여기는 애니메이션을 쓴다. 확대되며 들어가는 그림이 `이 필지를 본다`는 강조가 된다.
      핀 이동과 달리 연출 가치가 있고, 옆 필지로 옮기는 정도의 짧은 거리다.

      다만 requestAnimationFrame이 오지 않는 환경에서는 이 비행이 중간에 멈춘다.
      원격 데스크톱이나 가려진 창에서 600ms 동안 프레임이 0개인 것을 실측했다.
      그때는 지도가 출발한 자리에 남는다. 판정과 화면 표시에는 영향이 없다.
    */
    map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 18, duration: 0.7 });
  }, [ringKey, rings, map]);

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
