import {
  useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle,
  type RefObject,
} from "react";
import Hls from "hls.js";
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  Repeat, Repeat1, ChevronDown, Settings2, Loader2, AudioLines,
  SkipBack, SkipForward,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimeFormat = "standard" | "frames" | "timecode";

export interface Marker {
  timestampSec: number;
  orderIndex: number;
  color: "amber" | "sky" | "emerald";
  avatarUrl?: string | null;
  userName?: string | null;
  annotations?: string | null;  // JSON shapes para SVG overlay no vídeo
  commentBody?: string | null;
}

export interface PlayerHandle {
  capture: () => { time: number; dataUrl: string | null } | null;
  getCurrentTime: () => number;
  getTimeFormat: () => TimeFormat;
  getNaturalAr: () => number;
  pause: () => void;
  seekTo: (t: number) => void;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

export const fmtTime = (s: number | null | undefined): string => {
  if (s == null || !isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

export const formatTimecode = (t: number | null | undefined, fmt: TimeFormat, fps = 30): string => {
  const s = t ?? 0;
  if (!isFinite(s) || isNaN(s) || s < 0) {
    if (fmt === "frames") return "0";
    if (fmt === "timecode") return "00:00:00:00";
    return "0:00.0";
  }
  if (fmt === "frames") return String(Math.floor(s * fps));
  if (fmt === "timecode") {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sc = Math.floor(s % 60);
    const f = Math.floor((s % 1) * fps);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sc).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

// ── MiniAvatar (inline, usado nos marcadores do scrubber) ─────────────────────

function MiniAvatar({ name, avatarUrl, size = 18, borderColor }: {
  name?: string | null; avatarUrl?: string | null; size?: number; borderColor: string;
}) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", border: `2px solid ${borderColor}`,
      overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, background: "#1e1f26",
    }}>
      {avatarUrl
        ? <img src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ fontSize: 7, fontWeight: 700, color: borderColor, lineHeight: 1 }}>{initials}</span>
      }
    </div>
  );
}

// ── useVideoSync ──────────────────────────────────────────────────────────────

interface VideoSyncConfig {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  fillRef: RefObject<HTMLDivElement | null>;
  bufferRef: RefObject<HTMLDivElement | null>;
  thumbRef: RefObject<HTMLDivElement | null>;
  timeDisplayRef: RefObject<HTMLSpanElement | null>;
  durDisplayRef: RefObject<HTMLSpanElement | null>;
  isDragging: RefObject<boolean>;
  timeFormat: TimeFormat;
}

export function useVideoSync({ mediaRef, fillRef, bufferRef, thumbRef, timeDisplayRef, durDisplayRef, isDragging, timeFormat }: VideoSyncConfig) {
  useEffect(() => {
    const m = mediaRef.current; if (!m) return;
    const sync = () => {
      if (isDragging.current || !m.duration || !isFinite(m.duration)) return;
      const pct = `${(m.currentTime / m.duration) * 100}%`;
      if (fillRef.current) fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;
      if (m.buffered.length > 0 && bufferRef.current)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimecode(m.currentTime, timeFormat);
      if (durDisplayRef.current) durDisplayRef.current.textContent = formatTimecode(m.duration, timeFormat);
    };
    const syncBuf = () => {
      if (!m.duration || !bufferRef.current || !m.buffered.length) return;
      bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
    };
    m.addEventListener("timeupdate", sync); m.addEventListener("seeked", sync);
    m.addEventListener("loadedmetadata", sync); m.addEventListener("progress", syncBuf);
    return () => {
      m.removeEventListener("timeupdate", sync); m.removeEventListener("seeked", sync);
      m.removeEventListener("loadedmetadata", sync); m.removeEventListener("progress", syncBuf);
    };
  });
}

// ── useScrubBar ───────────────────────────────────────────────────────────────

interface ScrubBarConfig {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  markers: Marker[]; onMarkerClick: (t: number, annotations?: string | null) => void; onScrubStart?: () => void;
  timeFormat: TimeFormat;
  newMarkerTimestamp?: number | null;
}

export function useScrubBar({ mediaRef, markers, onMarkerClick, onScrubStart, timeFormat, newMarkerTimestamp }: ScrubBarConfig) {
  const trackRef   = useRef<HTMLDivElement>(null);
  const fillRef    = useRef<HTMLDivElement>(null);
  const bufferRef  = useRef<HTMLDivElement>(null);
  const thumbRef   = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const seekTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeekRatio = useRef<number | null>(null);

  const getRatio = (x: number) => {
    const el = trackRef.current; if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - left) / width));
  };
  const applyVisuals = (r: number) => {
    const pct = `${r * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
    if (tooltipRef.current) {
      const m = mediaRef.current;
      if (m?.duration) tooltipRef.current.textContent = formatTimecode(r * m.duration, timeFormat);
      tooltipRef.current.style.left = pct;
    }
  };
  const doSeek = (r: number) => {
    const m = mediaRef.current; if (!m?.duration) return;
    const t = r * m.duration;
    if ("fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
    else (m as HTMLMediaElement).currentTime = t;
  };
  const scheduleDragSeek = (r: number) => {
    lastSeekRatio.current = r;
    if (seekTimer.current !== null) return;
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      const ratio = lastSeekRatio.current;
      if (ratio === null || !isDragging.current) return;
      const m = mediaRef.current; if (!m?.duration) return;
      const t = ratio * m.duration;
      if ("fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
      else (m as HTMLMediaElement).currentTime = t;
    }, 80);
  };
  const showThumb = () => { if (thumbRef.current) { thumbRef.current.style.opacity = "1"; thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)"; } };
  const hideThumb = () => { if (thumbRef.current) thumbRef.current.style.opacity = "0"; };
  const showTip   = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "1"; };
  const hideTip   = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "0"; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true; onScrubStart?.(); showThumb(); showTip();
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1.3)";
    const r = getRatio(e.clientX); applyVisuals(r); doSeek(r);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = getRatio(e.clientX);
    if (isDragging.current) { applyVisuals(r); scheduleDragSeek(r); }
    else if (tooltipRef.current) {
      const m = mediaRef.current;
      if (m?.duration) tooltipRef.current.textContent = formatTimecode(r * m.duration, timeFormat);
      tooltipRef.current.style.left = `${r * 100}%`;
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (seekTimer.current) { clearTimeout(seekTimer.current); seekTimer.current = null; }
    lastSeekRatio.current = null;
    const r = getRatio(e.clientX); applyVisuals(r); doSeek(r);
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)";
    hideTip(); hideThumb();
  };
  useEffect(() => () => { if (seekTimer.current) clearTimeout(seekTimer.current); }, []);

  const markerBorderColor = (c: Marker["color"]) =>
    c === "amber" ? "#f59e0b" : c === "emerald" ? "#10b981" : "#0ea5e9";

  const hasMarkers = markers.length > 0;
  const AVATAR_SIZE = 26;
  const TRACK_H     = 6;
  const PAD_TOP     = 10;

  const ScrubBar = (
    <div className="relative select-none"
      style={{ padding: hasMarkers ? `${PAD_TOP}px 0 ${AVATAR_SIZE + 10}px 0` : `${PAD_TOP}px 0`, cursor: "pointer", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerLeave={e => { if (!isDragging.current) { hideThumb(); hideTip(); } else onPointerUp(e as any); }}
      onPointerEnter={() => { if (!isDragging.current) { showThumb(); showTip(); } }}>

      {/* Track */}
      <div ref={trackRef} className="relative rounded-full"
        style={{ height: TRACK_H, background: "rgba(255,255,255,0.15)" }}>
        <div ref={bufferRef} className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: "0%", background: "rgba(255,255,255,0.28)", transition: "width 1s linear" }} />
        <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: "0%", background: "hsl(var(--primary))", transition: "none" }} />

        {/* Barras verticais no track */}
        {markers.map((mk, i) => {
          const pct   = (mk.timestampSec / (mediaRef.current?.duration || 1)) * 100;
          const color = markerBorderColor(mk.color);
          return (
            <div key={i}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 cursor-pointer group/bar"
              style={{ left: `${pct}%` }}
              onPointerDown={e => { e.stopPropagation(); onMarkerClick(mk.timestampSec, mk.annotations); }}>
              <div className="transition-all duration-100 group-hover/bar:scale-y-150 origin-center"
                style={{ width: 3, height: 14, borderRadius: 2, background: color }} />
            </div>
          );
        })}
      </div>

      {/* Thumb */}
      <div ref={thumbRef} className="absolute rounded-full pointer-events-none"
        style={{ width: 16, height: 16, top: PAD_TOP + TRACK_H / 2, left: "0%", transform: "translate(-50%,-50%)", background: "white", boxShadow: "0 1px 8px rgba(0,0,0,0.7)", opacity: 0, transition: "opacity 0.15s, transform 0.1s" }} />

      {/* Tooltip de timecode (hover no track) */}
      <div ref={tooltipRef} className="absolute pointer-events-none select-none"
        style={{ bottom: "calc(100% + 10px)", left: "0%", transform: "translateX(-50%)", opacity: 0, transition: "opacity 0.12s", background: "rgba(0,0,0,0.9)", color: "#fff", fontSize: 11, fontFamily: "ui-monospace,monospace", padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap" }}>
        0:00.0
      </div>

      {/* Avatares abaixo do track */}
      {hasMarkers && (
        <div style={{ position: "absolute", left: 0, right: 0, top: PAD_TOP + TRACK_H + 8 }}>
          {markers.map((mk, i) => {
            const pct   = (mk.timestampSec / (mediaRef.current?.duration || 1)) * 100;
            const bc    = markerBorderColor(mk.color);
            const isNew = newMarkerTimestamp != null && Math.abs(mk.timestampSec - newMarkerTimestamp) < 0.05;
            return (
              <div key={i}
                className="absolute -translate-x-1/2 group/av cursor-pointer"
                style={{ left: `${pct}%` }}
                onPointerDown={e => { e.stopPropagation(); onMarkerClick(mk.timestampSec, mk.annotations); }}>

                {/* Avatar — bounce quando é novo */}
                <div className="group-hover/av:scale-110 transition-transform duration-150"
                  style={isNew ? { animation: "avatarMarkerBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both" } : {}}>
                  <MiniAvatar name={mk.userName} avatarUrl={mk.avatarUrl} borderColor={bc} size={AVATAR_SIZE} />
                </div>

                {/* Popup rico estilo Frame.io */}
                <div className="absolute z-50 pointer-events-none"
                  style={{ bottom: AVATAR_SIZE + 10, left: "50%", transform: "translateX(-50%)", opacity: 0, transition: "opacity 0.15s, transform 0.15s", transitionDelay: "0.05s" }}
                  ref={el => {
                    // mostrar no hover via CSS class group
                    // usamos o hack de group-hover para controlar via CSS
                  }}>
                </div>

                {/* Card popup */}
                <div className="absolute z-50 pointer-events-none opacity-0 group-hover/av:opacity-100 transition-all duration-200 group-hover/av:scale-100 scale-95 origin-bottom"
                  style={{
                    bottom: AVATAR_SIZE + 20,
                    left: "50%",
                    transform: "translateX(-50%) scale(0.95)",
                    width: 200,
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    background: "#1e1f26",
                    padding: "10px 12px",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <MiniAvatar name={mk.userName} avatarUrl={mk.avatarUrl} borderColor={bc} size={20} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {mk.userName?.split(" ")[0] ?? "?"}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: "ui-monospace,monospace", color: bc, fontWeight: 700 }}>
                      {fmtTime(mk.timestampSec)}
                    </span>
                  </div>
                  {mk.commentBody && (
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {mk.commentBody}
                    </p>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  return { ScrubBar, fillRef, bufferRef, thumbRef, isDragging };
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const FORMATS: { id: TimeFormat; label: string; example: string }[] = [
  { id: "standard", label: "Standard",  example: "1:23.5 / 4:55.2" },
  { id: "frames",   label: "Frames",    example: "2505 / 8856" },
  { id: "timecode", label: "Timecode",  example: "00:01:23:15" },
];

export const VideoPlayer = forwardRef<PlayerHandle, {
  src: string; fill?: boolean;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[]; onMarkerClick: (t: number, annotations?: string | null) => void;
  onScrub?: () => void;
  onSeeked?: () => void;
  maxHeight?: string;
  timeFormat?: TimeFormat;
  onTimeFormatChange?: (fmt: TimeFormat) => void;
  newMarkerTimestamp?: number | null;
  overlay?: React.ReactNode;
}>(function VideoPlayer({ src, seekTo, markers, onMarkerClick, onScrub, onSeeked, fill, maxHeight, timeFormat: externalFmt, onTimeFormatChange, newMarkerTimestamp, overlay }, ref) {

  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef      = useRef<HTMLSpanElement>(null);
  const durRef       = useRef<HTMLSpanElement>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying]       = useState(false);
  const [waiting, setWaiting]       = useState(false);
  const sessionKey = `vp:${src}`;
  const [hasEverPlayed, setHasEverPlayed] = useState(() => sessionStorage.getItem(sessionKey) === "1");
  const [volume, setVolume]     = useState(1);
  const [muted, setMuted]       = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loop, setLoop]         = useState(false);
  const [speed, setSpeed]       = useState(1);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<{ index: number; label: string }[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = auto (escolha do usuário)
  const [playingLevel, setPlayingLevel] = useState(-1); // nível que está de fato tocando
  const hlsRef = useRef<Hls | null>(null);

  // timeFormat: controlled if externalFmt provided, else internal
  const [internalFmt, setInternalFmt] = useState<TimeFormat>("standard");
  const timeFormat = externalFmt ?? internalFmt;
  const setTimeFormat = (fmt: TimeFormat) => {
    setInternalFmt(fmt);
    onTimeFormatChange?.(fmt);
  };

  useImperativeHandle(ref, () => ({
    capture: () => {
      const v = videoRef.current; if (!v) return null;
      try {
        const scale = Math.min(1, 480 / (v.videoWidth || 480));
        const c = document.createElement("canvas");
        c.width = (v.videoWidth || 480) * scale; c.height = (v.videoHeight || 270) * scale;
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        return { time: v.currentTime, dataUrl: c.toDataURL("image/jpeg", 0.8) };
      } catch { return { time: videoRef.current?.currentTime ?? 0, dataUrl: null }; }
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getNaturalAr: () => {
      const v = videoRef.current;
      return v && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
    },
    getTimeFormat: () => timeFormat,
    pause: () => videoRef.current?.pause(),
    seekTo: (t: number) => { if (videoRef.current) videoRef.current.currentTime = t; },
  }), [timeFormat]);

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: videoRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers, onMarkerClick, onScrubStart: () => { setShowControls(true); onScrub?.(); }, timeFormat, newMarkerTimestamp,
  });
  useVideoSync({ mediaRef: videoRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, durDisplayRef: durRef, isDragging, timeFormat });

  // HLS adaptive streaming — ativa quando src é um manifesto .m3u8
  const isHls = src.includes(".m3u8");
  useEffect(() => {
    const v = videoRef.current;
    setQualityLevels([]);
    setCurrentLevel(-1);
    if (!v || !isHls) { hlsRef.current = null; return; }

    if (Hls.isSupported()) {
      // hls.js tem suporte (MSE disponível) — usar sempre, inclusive no Safari moderno
      // Isso garante controle de qualidade em todos os browsers
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      // Fallback: Safari antigo sem MSE — HLS nativo, sem controle de qualidade
      v.src = src;
      return;
    } else {
      return; // browser sem suporte a HLS
    }

    const hls = new Hls({ startLevel: -1, capLevelToPlayerSize: true, maxBufferLength: 30, maxMaxBufferLength: 60 });
    hlsRef.current = hls;
    hls.loadSource(src);
    hls.attachMedia(v);

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      const levels = data.levels.map((l, i) => ({
        index: i,
        label: l.height ? `${l.height}p` : `Nível ${i + 1}`,
      }));
      setQualityLevels(levels);
    });

    // Atualiza o label "Auto (Xp)" apenas quando em modo automático
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      setCurrentLevel(prev => prev === -1 ? -1 : prev); // mantém seleção manual intacta
      setPlayingLevel(data.level);
    });

    return () => { hls.destroy(); hlsRef.current = null; };
  }, [src, isHls]);

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const onPlay    = () => { setPlaying(true); setWaiting(false); setHasEverPlayed(prev => { if (!prev) sessionStorage.setItem(sessionKey, "1"); return true; }); };
    const onPause   = () => setPlaying(false);
    const onWait    = () => setWaiting(true);
    const onResume  = () => setWaiting(false);
    const onVol     = () => { setVolume(v.volume); setMuted(v.muted); };
    const onFS      = () => setFullscreen(!!document.fullscreenElement);
    const onEnded   = () => { if (loop) { v.currentTime = 0; v.play(); } };
    v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait); v.addEventListener("playing", onResume); v.addEventListener("canplay", onResume);
    v.addEventListener("volumechange", onVol); v.addEventListener("ended", onEnded);
    document.addEventListener("fullscreenchange", onFS);
    return () => {
      v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWait); v.removeEventListener("playing", onResume); v.removeEventListener("canplay", onResume);
      v.removeEventListener("volumechange", onVol); v.removeEventListener("ended", onEnded);
      document.removeEventListener("fullscreenchange", onFS);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [src, loop]);

  useEffect(() => {
    if (!seekTo) return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seekTo.t;
    if (onSeeked) {
      const handler = () => { onSeeked(); v.removeEventListener("seeked", handler); };
      v.addEventListener("seeked", handler);
    }
  }, [seekTo]);
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed; }, [speed]);

  // Pré-carrega o arquivo inteiro em background para scrub instantâneo
  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    fetch(src, { signal: ctrl.signal, credentials: "include" }).catch(() => {});
    return () => ctrl.abort();
  }, [src]);

  const resetHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);
  useEffect(() => {
    if (!playing) { setShowControls(true); if (hideTimer.current) clearTimeout(hideTimer.current); }
    else resetHide();
  }, [playing, resetHide]);

  // Close popups on outside click
  useEffect(() => {
    if (!showSpeedPicker && !showFormatPicker && !showQualityPicker) return;
    const handler = () => { setShowSpeedPicker(false); setShowFormatPicker(false); setShowQualityPicker(false); };
    setTimeout(() => document.addEventListener("pointerdown", handler), 0);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showSpeedPicker, showFormatPicker, showQualityPicker]);

  const selectQuality = (level: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (level === -1) {
      hls.currentLevel = -1; // reativa ABR automático
    } else {
      hls.currentLevel = level; // desativa ABR e fixa a qualidade
      hls.nextLevel    = level; // força troca já no próximo segmento
    }
    setCurrentLevel(level);
    setShowQualityPicker(false);
  };

  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play().catch(() => {}) : v.pause(); };
  const skip       = (d: number) => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
  const setVol     = (val: number) => { const v = videoRef.current; if (v) { v.volume = val; v.muted = val === 0; } };
  const toggleFS   = () => { if (document.fullscreenElement) document.exitFullscreen(); else containerRef.current?.requestFullscreen(); };

  const ctrlVisible = showControls || !playing;

  const videoStyle = fullscreen
    ? { width: "100%", height: "100vh", objectFit: "contain" as const }
    : fill
      ? { width: "100%", height: "100%", objectFit: "contain" as const }
      : { maxHeight: maxHeight ?? "55vh", minHeight: 180 };

  const iconBtn = "shrink-0 flex items-center justify-center rounded-lg text-white/55 hover:text-white hover:bg-white/12 transition-colors";

  return (
    <div ref={containerRef}
      className={`relative bg-black select-none overflow-hidden ${fill ? "w-full h-full" : "w-full"}`}
      style={{ cursor: ctrlVisible ? "default" : "none" }}
      onMouseMove={resetHide} onMouseLeave={() => { if (playing) setShowControls(false); }}>

      {/* Video element */}
      <video ref={videoRef} src={isHls ? undefined : src} preload="auto" playsInline
        className={fill ? "absolute inset-0 w-full h-full object-contain" : "w-full block"}
        style={videoStyle} onClick={togglePlay} />

      {waiting && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="h-8 w-8 text-white/70 animate-spin" /></div>}
      {!playing && !waiting && !hasEverPlayed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
            <Play className="h-6 w-6 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* ── Controls overlay ── */}
      <div className="absolute inset-x-0 bottom-0"
        style={{ opacity: ctrlVisible ? 1 : 0, pointerEvents: ctrlVisible ? "auto" : "none", transition: "opacity 0.25s" }}>

        {/* Gradient */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }} />

        <div className="relative px-3 pb-2 pt-1" style={{ paddingTop: 24 }}>
          {/* Scrubbar */}
          {ScrubBar}

          {/* Control row */}
          <div className="flex items-center gap-1 mt-1.5" style={{ height: 48 }}>

            {/* ── LEFT ── */}
            <div className="flex items-center gap-0.5">
              <button onClick={() => skip(-10)} className={`${iconBtn} w-10 h-10`}><SkipBack className="h-5 w-5" /></button>
              <button onClick={togglePlay} className={`${iconBtn} w-10 h-10`}>
                {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white ml-0.5" />}
              </button>
              <button onClick={() => skip(10)} className={`${iconBtn} w-10 h-10`}><SkipForward className="h-5 w-5" /></button>

              <button onClick={() => setLoop(l => !l)}
                className={`${iconBtn} w-10 h-10 ${loop ? "!text-[hsl(var(--primary))]" : ""}`}>
                {loop ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
              </button>

              <div className="relative">
                <button onClick={e => { e.stopPropagation(); setShowSpeedPicker(v => !v); setShowFormatPicker(false); }}
                  className={`${iconBtn} h-10 px-2.5 text-xs font-bold font-mono`}>
                  {speed}×
                </button>
                {showSpeedPicker && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg overflow-hidden border border-white/10"
                    style={{ background: "rgba(18,18,22,0.97)", backdropFilter: "blur(16px)", minWidth: 72 }}
                    onPointerDown={e => e.stopPropagation()}>
                    {SPEEDS.map(s => (
                      <button key={s} onClick={() => { setSpeed(s); setShowSpeedPicker(false); }}
                        className="w-full px-3 py-1.5 text-[11px] font-bold font-mono text-left hover:bg-white/8 transition-colors"
                        style={{ color: speed === s ? "hsl(var(--primary))" : "rgba(255,255,255,0.6)" }}>
                        {s}×
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={toggleMute} className={`${iconBtn} w-10 h-10`}>
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                onChange={e => setVol(+e.target.value)}
                className="cursor-pointer hidden sm:block"
                style={{ width: 64, height: 4, accentColor: "hsl(var(--primary))" }} />
            </div>

            {/* ── CENTER: time display + format picker ── */}
            <div className="flex-1 flex justify-center">
              <div className="relative flex items-center">
                <button onClick={e => { e.stopPropagation(); setShowFormatPicker(v => !v); setShowSpeedPicker(false); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/10 transition-colors group">
                  <span className="font-mono text-[13px] text-white/70 group-hover:text-white/90">
                    <span ref={timeRef}>0:00.0</span>
                    <span className="text-white/30 mx-1">/</span>
                    <span ref={durRef}>0:00.0</span>
                  </span>
                  <ChevronDown className="h-3 w-3 text-white/30 group-hover:text-white/60" />
                </button>

                {showFormatPicker && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-xl overflow-hidden border border-white/10"
                    style={{ background: "rgba(18,18,22,0.97)", backdropFilter: "blur(16px)", minWidth: 220 }}
                    onPointerDown={e => e.stopPropagation()}>
                    {FORMATS.map(f => (
                      <button key={f.id} onClick={() => { setTimeFormat(f.id); setShowFormatPicker(false); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/8 transition-colors gap-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: timeFormat === f.id ? "hsl(var(--primary))" : "transparent", border: timeFormat === f.id ? "none" : "1px solid rgba(255,255,255,0.2)" }} />
                          <span className="text-xs font-semibold text-white/80">{f.label}</span>
                        </div>
                        <span className="text-[10px] text-white/30 font-mono">{f.example}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT ── */}
            <div className="flex items-center gap-0.5">
              {/* Seletor de qualidade — aparece sempre que o src é HLS */}
              {isHls && (
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setShowQualityPicker(v => !v); setShowSpeedPicker(false); setShowFormatPicker(false); }}
                    className={`${iconBtn} h-10 px-2.5 gap-1.5 flex items-center`}
                    title="Qualidade de vídeo">
                    <Settings2 className="h-4 w-4" />
                    <span className="text-[10px] font-bold font-mono">
                      {qualityLevels.length === 0
                        ? "…"
                        : currentLevel === -1
                          ? playingLevel >= 0
                            ? `Auto · ${qualityLevels[playingLevel]?.label ?? ""}`
                            : "Auto"
                          : qualityLevels[currentLevel]?.label ?? "Auto"}
                    </span>
                  </button>
                  {showQualityPicker && qualityLevels.length > 0 && (
                    <div className="absolute bottom-full right-0 mb-2 z-50 rounded-xl overflow-hidden border border-white/10"
                      style={{ background: "rgba(18,18,22,0.97)", backdropFilter: "blur(16px)", minWidth: 110 }}
                      onPointerDown={e => e.stopPropagation()}>
                      <button onClick={() => selectQuality(-1)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/8 transition-colors">
                        <div className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: currentLevel === -1 ? "hsl(var(--primary))" : "transparent", border: currentLevel === -1 ? "none" : "1px solid rgba(255,255,255,0.2)" }} />
                        <span className="text-xs font-semibold text-white/80">Auto</span>
                      </button>
                      {[...qualityLevels].reverse().map(q => (
                        <button key={q.index} onClick={() => selectQuality(q.index)}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-white/8 transition-colors">
                          <div className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: currentLevel === q.index ? "hsl(var(--primary))" : "transparent", border: currentLevel === q.index ? "none" : "1px solid rgba(255,255,255,0.2)" }} />
                          <span className="text-xs font-semibold text-white/80">{q.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button onClick={toggleFS} className={`${iconBtn} w-10 h-10`}>
                {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay externo — renderizado dentro do container para garantir z-index correto */}
      {overlay}
    </div>
  );
});

// ── AudioPlayer ───────────────────────────────────────────────────────────────

export const AudioPlayer = forwardRef<PlayerHandle, {
  src: string;
  fileName: string;
  fill?: boolean;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[];
  onMarkerClick: (t: number, annotations?: string | null) => void;
  onScrub?: () => void;
  onSeeked?: () => void;
  timeFormat?: TimeFormat;
  onTimeFormatChange?: (fmt: TimeFormat) => void;
  overlay?: React.ReactNode;
}>(function AudioPlayer({ src, fileName, fill, seekTo, markers, onMarkerClick, onScrub, onSeeked, timeFormat: externalFmt, onTimeFormatChange, overlay }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef     = useRef<HTMLAudioElement>(null);
  const timeRef      = useRef<HTMLSpanElement>(null);
  const durRef       = useRef<HTMLSpanElement>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying]         = useState(false);
  const [volume, setVolume]           = useState(1);
  const [muted, setMuted]             = useState(false);
  const [speed, setSpeed]             = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen]   = useState(false);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [internalFmt, setInternalFmt] = useState<TimeFormat>("standard");
  const timeFormat = externalFmt ?? internalFmt;

  const setTimeFormat = (fmt: TimeFormat) => { setInternalFmt(fmt); onTimeFormatChange?.(fmt); };

  useImperativeHandle(ref, () => ({
    capture:        () => { const a = audioRef.current; if (!a) return null; return { time: a.currentTime, dataUrl: null }; },
    getCurrentTime: () => audioRef.current?.currentTime ?? 0,
    getTimeFormat:  () => timeFormat,
    getNaturalAr:   () => 16 / 9,
    pause:          () => audioRef.current?.pause(),
    seekTo:         (t: number) => { if (audioRef.current) audioRef.current.currentTime = t; },
  }), [timeFormat]);

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: audioRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers, onMarkerClick,
    onScrubStart: () => { setShowControls(true); onScrub?.(); },
    timeFormat,
  });
  useVideoSync({ mediaRef: audioRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, durDisplayRef: durRef, isDragging, timeFormat });

  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol   = () => { setVolume(a.volume); setMuted(a.muted); };
    const onFS    = () => setFullscreen(!!document.fullscreenElement);
    a.addEventListener("play", onPlay); a.addEventListener("pause", onPause); a.addEventListener("volumechange", onVol);
    document.addEventListener("fullscreenchange", onFS);
    return () => {
      a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); a.removeEventListener("volumechange", onVol);
      document.removeEventListener("fullscreenchange", onFS);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [src]);

  useEffect(() => {
    if (!seekTo) return;
    const a = audioRef.current; if (!a) return;
    a.currentTime = seekTo.t;
    if (onSeeked) {
      const handler = () => { onSeeked(); a.removeEventListener("seeked", handler); };
      a.addEventListener("seeked", handler);
    }
  }, [seekTo]);

  useEffect(() => { const a = audioRef.current; if (a) a.playbackRate = speed; }, [speed]);

  const resetHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);
  useEffect(() => {
    if (!playing) { setShowControls(true); if (hideTimer.current) clearTimeout(hideTimer.current); }
    else resetHide();
  }, [playing, resetHide]);

  useEffect(() => {
    if (!showSpeedPicker) return;
    const handler = () => setShowSpeedPicker(false);
    setTimeout(() => document.addEventListener("pointerdown", handler), 0);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showSpeedPicker]);

  const togglePlay = () => { const a = audioRef.current; if (a) a.paused ? a.play().catch(() => {}) : a.pause(); };
  const skip       = (d: number) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + d)); };
  const toggleMute = () => { const a = audioRef.current; if (a) a.muted = !a.muted; };
  const setVol     = (val: number) => { const a = audioRef.current; if (a) { a.volume = val; a.muted = val === 0; } };
  const toggleFS   = () => { if (document.fullscreenElement) document.exitFullscreen(); else containerRef.current?.requestFullscreen(); };

  const ctrlVisible = showControls || !playing;
  const iconBtn = "shrink-0 flex items-center justify-center rounded-lg text-white/55 hover:text-white hover:bg-white/12 transition-colors";

  return (
    <div ref={containerRef}
      className={`relative select-none overflow-hidden ${fill ? "w-full h-full" : "w-full aspect-video"}`}
      style={{ background: "#08080d", cursor: ctrlVisible ? "default" : "none" }}
      onMouseMove={resetHide}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={togglePlay}>

      {/* Cover — ícone centralizado com gradiente radial */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 38%, hsl(var(--primary)/0.18) 0%, transparent 62%)" }}>
        <div className="relative flex items-center justify-center"
          style={{ width: 72, height: 72, borderRadius: 18, background: "hsl(var(--primary)/0.10)", border: "1px solid hsl(var(--primary)/0.22)" }}>
          <AudioLines className="h-8 w-8" style={{ color: "hsl(var(--primary))", opacity: playing ? 1 : 0.65 }} />
          {playing && (
            <div className="absolute inset-0 ring-2 ring-[hsl(var(--primary))]/20 animate-ping"
              style={{ borderRadius: 18, animationDuration: "1.6s" }} />
          )}
        </div>
        <p className="text-[13px] text-white/40 font-medium text-center px-8 max-w-full truncate">{fileName}</p>
      </div>

      {/* Play hint inicial */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
            <Play className="h-6 w-6 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Controls overlay — mesma estrutura do VideoPlayer */}
      <div className="absolute inset-x-0 bottom-0"
        style={{ opacity: ctrlVisible ? 1 : 0, pointerEvents: ctrlVisible ? "auto" : "none", transition: "opacity 0.25s" }}
        onClick={e => e.stopPropagation()}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }} />

        <div className="relative px-3 pb-2" style={{ paddingTop: 24 }}>
          {ScrubBar}

          <div className="flex items-center gap-1 mt-1.5" style={{ height: 48 }}>
            {/* LEFT */}
            <div className="flex items-center gap-0.5">
              <button onClick={() => skip(-10)} className={`${iconBtn} w-10 h-10`}><SkipBack className="h-5 w-5" /></button>
              <button onClick={togglePlay}      className={`${iconBtn} w-10 h-10`}>
                {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white ml-0.5" />}
              </button>
              <button onClick={() => skip(10)}  className={`${iconBtn} w-10 h-10`}><SkipForward className="h-5 w-5" /></button>

              <div className="relative">
                <button onClick={e => { e.stopPropagation(); setShowSpeedPicker(v => !v); }}
                  className={`${iconBtn} h-10 px-2.5 text-xs font-bold font-mono`}>{speed}×</button>
                {showSpeedPicker && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg overflow-hidden border border-white/10"
                    style={{ background: "rgba(18,18,22,0.97)", backdropFilter: "blur(16px)", minWidth: 72 }}
                    onPointerDown={e => e.stopPropagation()}>
                    {SPEEDS.map(s => (
                      <button key={s} onClick={() => { setSpeed(s); setShowSpeedPicker(false); }}
                        className="w-full px-3 py-1.5 text-[11px] font-bold font-mono text-left hover:bg-white/8 transition-colors"
                        style={{ color: speed === s ? "hsl(var(--primary))" : "rgba(255,255,255,0.6)" }}>{s}×</button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={toggleMute} className={`${iconBtn} w-10 h-10`}>
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
                onChange={e => setVol(+e.target.value)}
                className="cursor-pointer hidden sm:block"
                style={{ width: 64, height: 4, accentColor: "hsl(var(--primary))" }} />
            </div>

            {/* CENTER: timecode */}
            <div className="flex-1 flex justify-center">
              <span className="font-mono text-[13px] text-white/70 px-2 py-1">
                <span ref={timeRef}>0:00.0</span>
                <span className="text-white/30 mx-1">/</span>
                <span ref={durRef}>0:00.0</span>
              </span>
            </div>

            {/* RIGHT */}
            <div className="flex items-center gap-0.5">
              <button onClick={toggleFS} className={`${iconBtn} w-10 h-10`}>
                {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <audio ref={audioRef} src={src} preload="auto" />
      {overlay}
    </div>
  );
});
