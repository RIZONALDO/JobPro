import {
  useEffect, useState, useRef, useCallback,
  type RefObject,
} from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, MapPin, Loader2, AudioLines,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Marker { timestampSec: number; orderIndex: number; color: "amber" | "sky" | "emerald"; }

// ── Utils ─────────────────────────────────────────────────────────────────────

export const fmtTime = (s: number | null | undefined): string => {
  if (s == null || !isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

// ── useVideoSync ──────────────────────────────────────────────────────────────

interface VideoSyncConfig {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  fillRef: RefObject<HTMLDivElement | null>;
  bufferRef: RefObject<HTMLDivElement | null>;
  thumbRef: RefObject<HTMLDivElement | null>;
  timeDisplayRef: RefObject<HTMLSpanElement | null>;
  isDragging: RefObject<boolean>;
}

export function useVideoSync({ mediaRef, fillRef, bufferRef, thumbRef, timeDisplayRef, isDragging }: VideoSyncConfig) {
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const sync = () => {
      if (isDragging.current || !m.duration || !isFinite(m.duration)) return;
      const pct = `${(m.currentTime / m.duration) * 100}%`;
      if (fillRef.current) fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;
      if (m.buffered.length > 0 && bufferRef.current)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
      if (timeDisplayRef.current)
        timeDisplayRef.current.textContent = `${fmtTime(m.currentTime)} / ${fmtTime(m.duration)}`;
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
  markers: Marker[]; onMarkerClick: (t: number) => void; onScrubStart?: () => void;
}

export function useScrubBar({ mediaRef, markers, onMarkerClick, onScrubStart }: ScrubBarConfig) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const rafId = useRef<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (m?.duration) tooltipRef.current.textContent = fmtTime(r * m.duration);
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
    }, 100);
  };
  const showThumb = () => { if (thumbRef.current) { thumbRef.current.style.opacity = "1"; thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)"; } };
  const hideThumb = () => { if (thumbRef.current) thumbRef.current.style.opacity = "0"; };
  const showTip   = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "1"; };
  const hideTip   = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "0"; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true; onScrubStart?.(); showThumb(); showTip();
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1.25)";
    const r = getRatio(e.clientX); applyVisuals(r); doSeek(r);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = getRatio(e.clientX);
    if (isDragging.current) { applyVisuals(r); scheduleDragSeek(r); }
    else if (tooltipRef.current) {
      const m = mediaRef.current;
      if (m?.duration) tooltipRef.current.textContent = fmtTime(r * m.duration);
      tooltipRef.current.style.left = `${r * 100}%`;
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
    if (seekTimer.current) { clearTimeout(seekTimer.current); seekTimer.current = null; }
    lastSeekRatio.current = null;
    const r = getRatio(e.clientX); applyVisuals(r); doSeek(r);
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)";
    hideTip(); hideThumb();
  };
  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    if (seekTimer.current) clearTimeout(seekTimer.current);
  }, []);

  const markerColor = (c: Marker["color"]) =>
    c === "amber" ? "bg-amber-400" : c === "emerald" ? "bg-emerald-400" : "bg-sky-400";

  const ScrubBar = (
    <div className="relative select-none" style={{ padding: "10px 0", cursor: "pointer", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerLeave={e => { if (!isDragging.current) { hideThumb(); hideTip(); } else onPointerUp(e as any); }}
      onPointerEnter={() => { if (!isDragging.current) { showThumb(); showTip(); } }}>
      <div ref={trackRef} className="relative rounded-full" style={{ height: 4, background: "rgba(255,255,255,0.2)" }}>
        <div ref={bufferRef} className="absolute inset-y-0 left-0 rounded-full" style={{ width: "0%", background: "rgba(255,255,255,0.35)", transition: "width 1s linear" }} />
        <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-full" style={{ width: "0%", background: "hsl(var(--primary))", transition: "none" }} />
        {markers.map((mk, i) => (
          <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer z-10 group/mk"
            style={{ left: `${(mk.timestampSec / (mediaRef.current?.duration || 1)) * 100}%`, width: 12, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
            onPointerDown={e => { e.stopPropagation(); onMarkerClick(mk.timestampSec); }}>
            <div className={`rounded-sm transition-transform group-hover/mk:scale-150 ${markerColor(mk.color)}`} style={{ width: 3, height: 12 }} />
          </div>
        ))}
      </div>
      <div ref={thumbRef} className="absolute rounded-full pointer-events-none"
        style={{ width: 14, height: 14, top: "50%", left: "0%", transform: "translate(-50%,-50%)", background: "white", boxShadow: "0 1px 6px rgba(0,0,0,0.6)", opacity: 0, transition: "opacity 0.15s, transform 0.1s" }} />
      <div ref={tooltipRef} className="absolute pointer-events-none select-none"
        style={{ bottom: "calc(100% + 12px)", left: "0%", transform: "translateX(-50%)", opacity: 0, transition: "opacity 0.12s", background: "rgba(0,0,0,0.88)", color: "#fff", fontSize: 11, fontFamily: "ui-monospace,monospace", padding: "3px 8px", borderRadius: 5, whiteSpace: "nowrap" }}>
        0:00.0
      </div>
    </div>
  );
  return { ScrubBar, fillRef, bufferRef, thumbRef, isDragging };
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

export function VideoPlayer({ src, reviewMode, initialTime, seekTo, markers, onMarkerClick, onCapture, maxHeight }: {
  src: string; reviewMode: boolean; initialTime?: number;
  maxHeight?: string;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[]; onMarkerClick: (t: number) => void;
  onCapture: (time: number, dataUrl: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: videoRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers, onMarkerClick, onScrubStart: () => setShowControls(true),
  });
  useVideoSync({ mediaRef: videoRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, isDragging });

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    const onPlay = () => { setPlaying(true); setWaiting(false); };
    const onPause = () => setPlaying(false);
    const onWait = () => setWaiting(true);
    const onResume = () => setWaiting(false);
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onFS = () => setFullscreen(!!document.fullscreenElement);
    v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait); v.addEventListener("playing", onResume); v.addEventListener("canplay", onResume);
    v.addEventListener("volumechange", onVol); document.addEventListener("fullscreenchange", onFS);
    return () => {
      v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWait); v.removeEventListener("playing", onResume); v.removeEventListener("canplay", onResume);
      v.removeEventListener("volumechange", onVol); document.removeEventListener("fullscreenchange", onFS);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [src]);

  useEffect(() => {
    if (!initialTime) return;
    const v = videoRef.current; if (!v) return;
    const go = () => { v.currentTime = initialTime; };
    v.addEventListener("loadedmetadata", go, { once: true });
    if (v.readyState >= 1) go();
    return () => v.removeEventListener("loadedmetadata", go);
  }, [initialTime, src]);

  useEffect(() => { if (!seekTo) return; const v = videoRef.current; if (v) v.currentTime = seekTo.t; }, [seekTo]);

  const resetHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);
  useEffect(() => {
    if (!playing) { setShowControls(true); if (hideTimer.current) clearTimeout(hideTimer.current); }
    else resetHide();
  }, [playing, resetHide]);

  const togglePlay  = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); };
  const skip        = (d: number) => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const stepFrame   = (dir: 1 | -1) => { const v = videoRef.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / 30)); };
  const toggleMute  = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
  const setVol      = (val: number) => { const v = videoRef.current; if (v) { v.volume = val; v.muted = val === 0; } };
  const toggleFS    = () => { if (document.fullscreenElement) document.exitFullscreen(); else containerRef.current?.requestFullscreen(); };
  const captureFrame = () => {
    const v = videoRef.current; if (!v) return; v.pause();
    try {
      const scale = Math.min(1, 480 / (v.videoWidth || 480));
      const c = document.createElement("canvas");
      c.width = (v.videoWidth || 480) * scale; c.height = (v.videoHeight || 270) * scale;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      onCapture(v.currentTime, c.toDataURL("image/jpeg", 0.8));
    } catch { onCapture(v.currentTime, null); }
  };

  const ctrlVisible = showControls || !playing;
  const mh = maxHeight ?? "55vh";

  return (
    <div ref={containerRef} className="relative w-full bg-black select-none overflow-hidden"
      style={{ cursor: ctrlVisible ? "default" : "none" }}
      onMouseMove={resetHide} onMouseLeave={() => { if (playing) setShowControls(false); }}>
      <video ref={videoRef} src={src} preload="auto" playsInline className="w-full block"
        style={fullscreen ? { width: "100%", height: "100vh", objectFit: "contain" } : { maxHeight: mh, minHeight: 180 }}
        onClick={togglePlay} />
      {waiting && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="h-8 w-8 text-white/70 animate-spin" /></div>}
      {!playing && !waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
            <Play className="h-6 w-6 text-white fill-white ml-1" />
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ opacity: ctrlVisible ? 1 : 0, pointerEvents: ctrlVisible ? "auto" : "none", transition: "opacity 0.25s" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }} />
        <div className="relative px-4 pb-3" style={{ paddingTop: 32 }}>
          {ScrubBar}
          <div className="flex items-center gap-2.5 mt-1">
            <button onClick={togglePlay} className="text-white hover:text-white/80 shrink-0">
              {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white ml-0.5" />}
            </button>
            <button onClick={() => skip(-10)} className="text-white/55 hover:text-white shrink-0"><SkipBack className="h-4 w-4" /></button>
            <button onClick={() => skip(10)} className="text-white/55 hover:text-white shrink-0"><SkipForward className="h-4 w-4" /></button>
            <span ref={timeRef} className="shrink-0 tabular-nums" style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "ui-monospace,monospace" }}>0:00 / 0:00</span>
            <div className="flex-1" />
            {reviewMode && <>
              <button onClick={() => stepFrame(-1)} className="shrink-0 flex items-center justify-center rounded text-amber-300/80 hover:text-amber-100" style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.35)", fontSize: 10, fontFamily: "monospace" }}>◀|</button>
              <button onClick={() => stepFrame(1)}  className="shrink-0 flex items-center justify-center rounded text-amber-300/80 hover:text-amber-100" style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.35)", fontSize: 10, fontFamily: "monospace" }}>|▶</button>
              <button onClick={captureFrame} className="shrink-0 flex items-center gap-1.5 rounded-lg text-white font-semibold" style={{ padding: "4px 10px", background: "#f59e0b", fontSize: 11 }}
                onMouseOver={e => (e.currentTarget.style.background = "#d97706")} onMouseOut={e => (e.currentTarget.style.background = "#f59e0b")}>
                <MapPin className="h-3 w-3" />Marcar
              </button>
            </>}
            <button onClick={toggleMute} className="text-white/55 hover:text-white shrink-0">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={e => setVol(+e.target.value)}
              className="shrink-0 cursor-pointer" style={{ width: 60, height: 4, accentColor: "hsl(var(--primary))" }} />
            <button onClick={toggleFS} className="text-white/55 hover:text-white shrink-0">
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AudioPlayer ───────────────────────────────────────────────────────────────

export function AudioPlayer({ src, fileName, reviewMode, seekTo, markers, onMarkerClick, onCapture }: {
  src: string; fileName: string; reviewMode: boolean;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[]; onMarkerClick: (t: number) => void;
  onCapture: (time: number, dataUrl: string | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeRef  = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: audioRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>, markers, onMarkerClick,
  });
  useVideoSync({ mediaRef: audioRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, isDragging });
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false), onVol = () => { setVolume(a.volume); setMuted(a.muted); };
    a.addEventListener("play", onPlay); a.addEventListener("pause", onPause); a.addEventListener("volumechange", onVol);
    return () => { a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); a.removeEventListener("volumechange", onVol); };
  }, [src]);
  useEffect(() => { if (!seekTo) return; const a = audioRef.current; if (a) a.currentTime = seekTo.t; }, [seekTo]);
  const togglePlay = () => { const a = audioRef.current; if (a) a.paused ? a.play() : a.pause(); };
  const skip = (d: number) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + d)); };
  return (
    <div className="flex flex-col items-center gap-4 py-8 px-8 w-full max-w-xs mx-auto">
      <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center" style={{ background: "hsl(var(--primary)/0.12)", border: "1px solid hsl(var(--primary)/0.2)" }}>
        <AudioLines className={`h-7 w-7 text-[hsl(var(--primary))] ${playing ? "animate-pulse" : ""}`} />
        {playing && <div className="absolute inset-0 rounded-2xl ring-2 ring-[hsl(var(--primary))]/25 animate-ping" />}
      </div>
      <p className="text-xs text-zinc-300 text-center truncate w-full">{fileName}</p>
      <div className="w-full">
        {ScrubBar}
        <span ref={timeRef} className="block text-right mt-1 tabular-nums" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "ui-monospace,monospace" }}>0:00 / 0:00</span>
      </div>
      <div className="flex items-center gap-6">
        <button onClick={() => skip(-10)} className="flex flex-col items-center gap-0.5 text-zinc-500 hover:text-zinc-200"><SkipBack className="h-4 w-4" /><span style={{ fontSize: 9 }}>-10s</span></button>
        <button onClick={togglePlay} className="h-11 w-11 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>
          {playing ? <Pause className="h-5 w-5 text-white fill-white" /> : <Play className="h-5 w-5 text-white fill-white ml-0.5" />}
        </button>
        <button onClick={() => skip(10)} className="flex flex-col items-center gap-0.5 text-zinc-500 hover:text-zinc-200"><SkipForward className="h-4 w-4" /><span style={{ fontSize: 9 }}>+10s</span></button>
      </div>
      {reviewMode && (
        <button onClick={() => { const a = audioRef.current; if (a) { a.pause(); onCapture(a.currentTime, null); } }}
          className="flex items-center gap-2 w-full justify-center text-white font-semibold rounded-xl" style={{ padding: "8px 14px", background: "#f59e0b", fontSize: 12 }}>
          <MapPin className="h-3.5 w-3.5" />Marcar ponto
        </button>
      )}
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => { const a = audioRef.current; if (a) a.muted = !a.muted; }} className="text-zinc-500 hover:text-zinc-200 shrink-0">
          {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
          onChange={e => { const v = +e.target.value, a = audioRef.current; if (a) { a.volume = v; a.muted = v === 0; } }}
          className="flex-1 cursor-pointer" style={{ height: 4, accentColor: "hsl(var(--primary))" }} />
      </div>
      <audio ref={audioRef} src={src} preload="auto" />
    </div>
  );
}
