import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { useScrubBar, useVideoSync, type TimeFormat } from "./player";

interface Props {
  src: string;
  mimeType: string;
  fileName?: string;
}

export function FeedPlayer({ src, mimeType }: Props) {
  // Single ref works for both <video> and <audio> since both extend HTMLMediaElement
  const mediaRef    = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef      = useRef<HTMLSpanElement>(null);
  const durRef       = useRef<HTMLSpanElement>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollWants  = useRef(false);

  const [playing,       setPlaying]       = useState(false);
  const [muted,         setMuted]         = useState(true);
  const [waiting,       setWaiting]       = useState(false);
  const [showControls,  setShowControls]  = useState(false);
  const [fullscreen,    setFullscreen]    = useState(false);
  const [naturalAr,     setNaturalAr]     = useState<number | null>(null);
  const [hasEverPlayed, setHasEverPlayed] = useState(false);

  const isAudio    = mimeType?.startsWith("audio/");
  const isHls      = !isAudio && src.includes(".m3u8");
  const isPortrait = naturalAr !== null && naturalAr < 0.95;

  // ── HLS (video only) ──────────────────────────────────────────────────────
  useEffect(() => {
    const v = mediaRef.current;
    if (!v || !isHls || !(v instanceof HTMLVideoElement)) return;
    if (Hls.isSupported()) {
      const hls = new Hls({ startLevel: -1, capLevelToPlayerSize: true, maxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(v);
      return () => hls.destroy();
    } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
    }
  }, [src, isHls]);

  // ── Media events (shared) ─────────────────────────────────────────────────
  useEffect(() => {
    const m = mediaRef.current; if (!m) return;
    const onPlay  = () => { setPlaying(true); setWaiting(false); setHasEverPlayed(true); };
    const onPause = () => setPlaying(false);
    const onWait  = () => setWaiting(true);
    const onCan   = () => setWaiting(false);
    const onVol   = () => setMuted(m.muted);
    const onFS    = () => setFullscreen(!!document.fullscreenElement);
    const onMeta  = () => {
      if (m instanceof HTMLVideoElement && m.videoWidth && m.videoHeight)
        setNaturalAr(m.videoWidth / m.videoHeight);
    };
    m.addEventListener("play",           onPlay);
    m.addEventListener("pause",          onPause);
    m.addEventListener("waiting",        onWait);
    m.addEventListener("playing",        onCan);
    m.addEventListener("canplay",        onCan);
    m.addEventListener("volumechange",   onVol);
    m.addEventListener("loadedmetadata", onMeta);
    document.addEventListener("fullscreenchange", onFS);
    return () => {
      m.removeEventListener("play",           onPlay);
      m.removeEventListener("pause",          onPause);
      m.removeEventListener("waiting",        onWait);
      m.removeEventListener("playing",        onCan);
      m.removeEventListener("canplay",        onCan);
      m.removeEventListener("volumechange",   onVol);
      m.removeEventListener("loadedmetadata", onMeta);
      document.removeEventListener("fullscreenchange", onFS);
    };
  }, []);

  // ── Scroll autoplay (video only — audio muted-autoplay is pointless) ───────
  const syncPlay = useCallback(() => {
    const m = mediaRef.current; if (!m) return;
    if (scrollWants.current && m.paused)    m.play().catch(() => {});
    else if (!scrollWants.current && !m.paused) m.pause();
  }, []);

  useEffect(() => {
    if (isAudio) return;
    const el = containerRef.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      scrollWants.current = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      syncPlay();
    }, { threshold: [0.2, 0.5] });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isAudio, syncPlay]);

  // ── Controls hide timer ────────────────────────────────────────────────────
  const resetHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 2500);
  }, []);

  // ── Hover (video only — controls visibility) ──────────────────────────────
  const onMouseEnter = useCallback(() => { if (!isAudio) resetHide(); }, [isAudio, resetHide]);
  const onMouseLeave = useCallback(() => {
    if (isAudio) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowControls(false);
  }, [isAudio]);

  // ── Scrubbar (shared hook) ────────────────────────────────────────────────
  const timeFormat: TimeFormat = "standard";
  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: mediaRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers: [], onMarkerClick: () => {}, timeFormat,
  });
  useVideoSync({
    mediaRef:       mediaRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    fillRef, bufferRef, thumbRef,
    timeDisplayRef: timeRef,
    durDisplayRef:  durRef,
    isDragging,     timeFormat,
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const m = mediaRef.current; if (!m) return;
    if (m.paused) { scrollWants.current = true; m.play().catch(() => {}); }
    else          { scrollWants.current = false; m.pause(); }
    if (!isAudio) resetHide();
  }, [isAudio, resetHide]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const m = mediaRef.current; if (!m) return;
    m.muted = !m.muted;
    if (!isAudio) resetHide();
  }, [isAudio, resetHide]);

  const toggleFS = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen();
  }, []);

  // ── Audio player — Apple Music style ─────────────────────────────────────
  if (isAudio) {
    return (
      <div className="mx-4 mb-3">
        <audio ref={mediaRef as RefObject<HTMLAudioElement>} src={src} preload="metadata" />

        <div className="rounded-xl border px-4 py-3" style={{ background: "hsl(var(--card))" }}>

          {/* Single row: [▶] [0:00] ──scrubbar── [3:24] [🔇] */}
          <div className="flex items-center gap-2">

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="shrink-0 flex items-center justify-center transition-opacity active:opacity-60"
              style={{ width: 28, color: "hsl(var(--foreground))" }}
            >
              {waiting
                ? <Loader2 className="h-6 w-6 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
                : playing
                  ? <Pause className="h-6 w-6" style={{ fill: "hsl(var(--foreground))", stroke: "none" }} />
                  : <Play  className="h-6 w-6" style={{ fill: "hsl(var(--foreground))", stroke: "none" }} />}
            </button>

            {/* Current time */}
            <span
              ref={timeRef}
              className="text-[11px] font-mono tabular-nums select-none shrink-0"
              style={{ color: "hsl(var(--muted-foreground))", minWidth: 30, textAlign: "right" }}
            >
              0:00
            </span>

            {/* Scrubbar */}
            <div className="flex-1">{ScrubBar}</div>

            {/* Duration */}
            <span
              ref={durRef}
              className="text-[11px] font-mono tabular-nums select-none shrink-0"
              style={{ color: "hsl(var(--muted-foreground))", minWidth: 30 }}
            >
              0:00
            </span>

            {/* Mute */}
            <button
              onClick={toggleMute}
              className="shrink-0 flex items-center justify-center transition-colors"
              style={{ color: "hsl(var(--muted-foreground))", width: 20 }}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>

          </div>
        </div>
      </div>
    );
  }

  // ── Video player ──────────────────────────────────────────────────────────
  const ctrlVisible = showControls || !playing;

  const outerStyle: React.CSSProperties = naturalAr === null
    ? { width: "100%", aspectRatio: "16/9" }
    : isPortrait
      ? { maxWidth: 280, width: "100%", aspectRatio: `${naturalAr}`, margin: "0 auto" }
      : { width: "100%", maxHeight: 420, aspectRatio: `${naturalAr}` };

  return (
    <div style={{ overflow: "hidden", borderRadius: 4, background: "#000" }}>
      <div
        ref={containerRef}
        style={{ position: "relative", overflow: "hidden", background: "#000", ...outerStyle }}
        onMouseMove={resetHide}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={togglePlay}
        className="select-none"
      >
        <video
          ref={mediaRef as RefObject<HTMLVideoElement>}
          src={isHls ? undefined : src}
          preload="metadata"
          playsInline
          muted
          loop
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "contain", cursor: "default" }}
        />

        {/* Spinner */}
        {waiting && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Loader2 className="h-8 w-8 text-white/70 animate-spin" />
          </div>
        )}

        {/* Big play overlay — before first interaction */}
        {!playing && !waiting && !hasEverPlayed && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div style={{
              background: "rgba(0,0,0,0.52)", backdropFilter: "blur(6px)",
              borderRadius: 8, width: 52, height: 52,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Play className="h-6 w-6 text-white fill-white" style={{ marginLeft: 3 }} />
            </div>
          </div>
        )}

        {/* Mute — top-right */}
        <button
          onClick={toggleMute}
          className="absolute top-2.5 right-2.5 z-20 flex items-center justify-center transition-opacity duration-200"
          style={{
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
            borderRadius: 6, width: 30, height: 30,
            opacity: ctrlVisible ? 1 : 0.3, color: "white",
          }}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>

        {/* Bottom controls */}
        <div
          className="absolute inset-x-0 bottom-0 z-10"
          style={{
            opacity: ctrlVisible ? 1 : 0,
            pointerEvents: ctrlVisible ? "auto" : "none",
            transition: "opacity 0.2s",
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.22) 60%, transparent 100%)",
          }} />

          <div className="relative px-3 pb-2.5" style={{ paddingTop: 28 }}>
            {ScrubBar}
            <div className="flex items-center gap-1.5 mt-0.5" style={{ height: 32 }}>
              <button
                onClick={e => { e.stopPropagation(); togglePlay(); }}
                className="flex items-center justify-center text-white/90 hover:text-white transition-colors"
                style={{ width: 28, height: 28, borderRadius: 5, background: "rgba(255,255,255,0.1)", flexShrink: 0 }}
              >
                {playing
                  ? <Pause className="h-3.5 w-3.5 fill-white" />
                  : <Play  className="h-3.5 w-3.5 fill-white" style={{ marginLeft: 1 }} />}
              </button>

              <span className="text-[11px] font-mono text-white/55 ml-1 select-none tabular-nums">
                <span ref={timeRef}>0:00</span>
                <span className="text-white/25 mx-0.5">/</span>
                <span ref={durRef}>0:00</span>
              </span>

              <div className="flex-1" />

              <button
                onClick={toggleFS}
                className="flex items-center justify-center text-white/55 hover:text-white transition-colors"
                style={{ width: 26, height: 26 }}
              >
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
