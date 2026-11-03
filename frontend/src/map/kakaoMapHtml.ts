// WebView 안에서 실행되는 지도 HTML. KakaoMap.web.tsx 와 같은 Kakao JS SDK 지도를 그리되,
// React 대신 순수 JS 로 구현하고 RN ↔ WebView 는 메시지로 주고받는다(KakaoMap.tsx 참고).
// 차량 헤딩업 회전(headingUp)은 지금 앱 어디서도 쓰지 않아 여기선 구현하지 않는다.
// shortcut: headingUp 카메라 회전 미구현, 길안내 화면이 실제로 headingUp 을 쓰게 되면 추가한다.
export function kakaoMapHtml(appKey: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false"></script>
  <script>
    function post(message) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }

    var map = null;
    var markerOverlay = null;
    var markerElement = null;
    var markerArrow = null;
    var markerKind = null;
    var destinationOverlay = null;
    var polyline = null;
    var casing = null;
    var segmentLines = [];
    var placeOverlays = [];

    function toLatLngs(path) {
      return path.map(function (p) { return new kakao.maps.LatLng(p.lat, p.lng); });
    }

    function createDot() {
      var dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#2A5BD7',
        border: '3px solid #ffffff', boxShadow: '0 0 0 2px rgba(42, 91, 215, 0.35)',
      });
      return dot;
    }

    function createArrow() {
      var root = document.createElement('div');
      Object.assign(root.style, {
        width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#ffffff',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      });
      var rotor = document.createElement('div');
      Object.assign(rotor.style, { width: '28px', height: '28px' });
      rotor.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2.5 L20 21 L12 16.5 L4 21 Z" fill="#2A5BD7" stroke="#2A5BD7" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      root.appendChild(rotor);
      markerArrow = rotor;
      return root;
    }

    function createDestination() {
      var root = document.createElement('div');
      Object.assign(root.style, {
        width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#1F2430',
        border: '3px solid #ffffff', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      });
      var dot = document.createElement('div');
      Object.assign(dot.style, { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffffff' });
      root.appendChild(dot);
      return root;
    }

    // 작은 점(실제 좌표) + 그 밑에 떠 있는 이름표. 앵커(0.5, 0.5)가 점 크기만 기준으로 잡히도록
    // 이름표는 position: absolute 로 점 바깥에 덧붙인다(root 의 레이아웃 크기에 안 들어간다).
    function createPlaceMarker(color, label) {
      var root = document.createElement('div');
      root.setAttribute('role', 'img');
      root.setAttribute('aria-label', label);
      Object.assign(root.style, { position: 'relative', width: '14px', height: '14px' });

      var dot = document.createElement('div');
      Object.assign(dot.style, {
        width: '14px', height: '14px', borderRadius: '50%', backgroundColor: color,
        border: '2px solid #ffffff', boxShadow: '0 1px 4px rgba(15, 23, 42, 0.45)',
      });
      root.appendChild(dot);

      var tag = document.createElement('div');
      tag.textContent = label;
      Object.assign(tag.style, {
        position: 'absolute', top: '18px', left: '50%', transform: 'translateX(-50%)',
        maxWidth: '110px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        backgroundColor: '#ffffff', color: '#1F2430', fontSize: '11px', fontWeight: '700',
        padding: '2px 6px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(15, 23, 42, 0.3)',
      });
      root.appendChild(tag);

      return root;
    }

    function removeMarker() {
      if (markerOverlay) markerOverlay.setMap(null);
      markerOverlay = null;
      markerElement = null;
      markerArrow = null;
      markerKind = null;
    }

    window.KMAP = {
      clearRoute: function () {
        if (casing) casing.setMap(null);
        casing = null;
        if (polyline) polyline.setMap(null);
        polyline = null;
        segmentLines.forEach(function (line) { line.setMap(null); });
        segmentLines = [];
      },
      showRouteSegments: function (segments, options) {
        if (!map || !segments || segments.length === 0) return;
        window.KMAP.clearRoute();
        var bounds = new kakao.maps.LatLngBounds();
        segments.forEach(function (segment) {
          if (!segment.path || segment.path.length < 2) return;
          var points = toLatLngs(segment.path);
          segmentLines.push(new kakao.maps.Polyline({
            map: map, path: points, strokeWeight: segment.dashed ? 4 : 6, strokeColor: segment.color,
            strokeOpacity: segment.dashed ? 0.9 : 0.95, strokeStyle: segment.dashed ? 'dash' : 'solid',
          }));
          points.forEach(function (p) { bounds.extend(p); });
        });
        if (!options || options.fit !== false) map.setBounds(bounds);
      },
      showRoute: function (path, options) {
        if (!map || !path || path.length === 0) return;
        window.KMAP.clearRoute();
        var points = toLatLngs(path);
        if (options && options.style === 'driving') {
          casing = new kakao.maps.Polyline({ map: map, path: points, strokeWeight: 14, strokeColor: '#ffffff', strokeOpacity: 1 });
          polyline = new kakao.maps.Polyline({ map: map, path: points, strokeWeight: 9, strokeColor: '#5B5BD6', strokeOpacity: 1 });
        } else {
          polyline = new kakao.maps.Polyline({ map: map, path: points, strokeWeight: 5, strokeColor: '#5B5BD6', strokeOpacity: 0.85 });
        }
        if (options && options.fit === false) return;
        var bounds = new kakao.maps.LatLngBounds();
        points.forEach(function (p) { bounds.extend(p); });
        map.setBounds(bounds);
      },
      setRoutePath: function (path) {
        if (!polyline || !path || path.length === 0) return;
        var points = toLatLngs(path);
        if (casing) casing.setPath(points);
        polyline.setPath(points);
      },
      setDestination: function (point) {
        if (!map) return;
        if (destinationOverlay) destinationOverlay.setMap(null);
        destinationOverlay = null;
        if (!point) return;
        destinationOverlay = new kakao.maps.CustomOverlay({
          map: map, position: new kakao.maps.LatLng(point.lat, point.lng), content: createDestination(), xAnchor: 0.5, yAnchor: 0.5,
        });
      },
      setLocationMarker: function (point, options) {
        if (!map) return;
        if (!point) return removeMarker();
        var headingDeg = options && typeof options.headingDeg === 'number' ? options.headingDeg : null;
        var kind = headingDeg === null ? 'dot' : 'arrow';
        var position = new kakao.maps.LatLng(point.lat, point.lng);
        if (markerOverlay && markerKind !== kind) removeMarker();
        if (markerOverlay) {
          markerOverlay.setPosition(position);
        } else {
          markerElement = kind === 'arrow' ? createArrow() : createDot();
          markerKind = kind;
          markerOverlay = new kakao.maps.CustomOverlay({ map: map, position: position, content: markerElement, xAnchor: 0.5, yAnchor: 0.5 });
        }
        if (headingDeg !== null && markerArrow) markerArrow.style.transform = 'rotate(' + headingDeg + 'deg)';
        if (markerElement) markerElement.style.opacity = options && options.preview ? '0.55' : '1';
      },
      panTo: function (point, options) {
        if (!map) return;
        var position = new kakao.maps.LatLng(point.lat, point.lng);
        if (options && typeof options.level === 'number') {
          map.setLevel(options.level);
          map.setCenter(position);
        } else {
          map.panTo(position);
        }
      },
      followTo: function (point, options) {
        // headingUp 회전 없이, 해당 지점으로 레벨만 맞춰 이동한다(현재 앱에서 호출되지 않는 경로).
        window.KMAP.panTo(point, { level: options && options.level });
      },
      clearPlaces: function () {
        placeOverlays.forEach(function (ov) { ov.setMap(null); });
        placeOverlays = [];
      },
      showPlaces: function (places, color) {
        if (!map) return;
        window.KMAP.clearPlaces();
        if (!places || places.length === 0) return;
        var bounds = new kakao.maps.LatLngBounds();
        places.forEach(function (p, i) {
          var position = new kakao.maps.LatLng(p.point.lat, p.point.lng);
          bounds.extend(position);
          var content = createPlaceMarker(color, p.label);
          content.addEventListener('click', function () { post({ type: 'placeClick', index: i }); });
          var overlay = new kakao.maps.CustomOverlay({
            map: map, position: position, content: content, xAnchor: 0.5, yAnchor: 0.5,
          });
          placeOverlays.push(overlay);
        });
        map.setBounds(bounds);
      },
    };

    function init() {
      kakao.maps.load(function () {
        var center = new kakao.maps.LatLng(37.5665, 126.978);
        map = new kakao.maps.Map(document.getElementById('map'), { center: center, level: 4 });
        kakao.maps.event.addListener(map, 'click', function (event) {
          post({ type: 'mapClick', point: { lat: event.latLng.getLat(), lng: event.latLng.getLng() } });
        });
        kakao.maps.event.addListener(map, 'dragstart', function () { post({ type: 'userPan' }); });
        post({ type: 'ready' });
      });
    }

    if (window.kakao && window.kakao.maps) {
      init();
    } else {
      document.querySelector('script[src^="https://dapi.kakao.com"]').addEventListener('load', init);
      document.querySelector('script[src^="https://dapi.kakao.com"]').addEventListener('error', function () { post({ type: 'loadError' }); });
    }
  </script>
</body>
</html>`;
}
