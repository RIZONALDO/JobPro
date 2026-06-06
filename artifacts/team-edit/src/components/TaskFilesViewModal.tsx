/**
 * TaskFilesViewModal — player de vídeo/áudio profissional
 *
 * Arquitetura do player:
 * - useVideoSync: hook interno que sincroniza TODA a UI com o elemento <video>
 *   via manipulação direta de DOM (zero React re-renders durante playback/scrub)
 * - Pointer events + setPointerCapture: scrubbing confiável sem listeners no document
 * - preload="auto": download progressivo para seeks rápidos
 * - fastSeek() durante drag, seek exato no release
 */

import {
  useEffect, useState, useMemo, useRef, useCallback,
  type RefObject,
} from "react";
import { apiFetch, apiPost, apiPut, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Clapperboard, AudioLines, Download, CheckCircle2, ChevronRight,
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, MapPin, Send, X, CheckCircle, Loader2,
} from "lucide-react";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; createdAt: string;
  uploaderName: string | null; approvedAt: string | null; approvedByName: string | null;
}

interface PendingComment {
  localId: string; timestampSec: number; orderIndex: number;
  body: string; thumbnailDataUrl: string | null;
}

interface BatchComment {
  id: number; timestampSec: number; orderIndex: number;
  frameThumbnail: string | null; body: string;
}

interface Marker { timestampSec: number; orderIndex: number; color: "amber" | "sky" }

interface Props {
  open: boolean; onClose: () => void; taskId: number;
  taskCode?: string; taskTitle: string; taskStatus?: string;
  initialFileId?: number; initialTime?: number; onDone?: () => void;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

const fmtSize = (b: number | null) => {
  if (!b) return "";
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const fmtTime = (s: number): string => {
  if (!s || !isFinite(s) || isNaN(s)) return "0:00";
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms  = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

const revLabel = (n: number) => (n === 0 ? "Original" : `${n}ª alt.`);

// ── useVideoSync ──────────────────────────────────────────────────────────────
// Hook autocontido: anexa eventos ao <video>/<audio> e sincroniza toda a UI
// via manipulação direta de DOM — zero React re-renders durante playback.

interface VideoSyncConfig {
  mediaRef:       RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  fillRef:        RefObject<HTMLDivElement | null>;
  bufferRef:      RefObject<HTMLDivElement | null>;
  thumbRef:       RefObject<HTMLDivElement | null>;
  timeDisplayRef: RefObject<HTMLSpanElement | null>;
  isDragging:     RefObject<boolean>;
}

function useVideoSync({
  mediaRef, fillRef, bufferRef, thumbRef, timeDisplayRef, isDragging,
}: VideoSyncConfig) {
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;

    const sync = () => {
      if (isDragging.current || !m.duration || !isFinite(m.duration)) return;
      const ratio = m.currentTime / m.duration;
      const pct   = `${ratio * 100}%`;

      if (fillRef.current)  fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;

      if (m.buffered.length > 0 && bufferRef.current)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;

      if (timeDisplayRef.current)
        timeDisplayRef.current.textContent = `${fmtTime(m.currentTime)} / ${fmtTime(m.duration)}`;
    };

    // "progress" dispara conforme o download avança → atualiza buffer bar
    const syncBuffer = () => {
      if (!m.duration || !bufferRef.current) return;
      if (m.buffered.length > 0)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
    };

    m.addEventListener("timeupdate",      sync);
    m.addEventListener("seeked",          sync);
    m.addEventListener("loadedmetadata",  sync);
    m.addEventListener("progress",        syncBuffer);

    return () => {
      m.removeEventListener("timeupdate",     sync);
      m.removeEventListener("seeked",         sync);
      m.removeEventListener("loadedmetadata", sync);
      m.removeEventListener("progress",       syncBuffer);
    };
  }); // sem deps: corre a cada render mas é idempotente; o componente faz `key` remount ao trocar src
}

// ── useScrubBar ───────────────────────────────────────────────────────────────
// Controle do scrubber: pointer events, setPointerCapture, RAF seek.
// Expõe o JSX da barra e os refs internos para useVideoSync.

interface ScrubBarConfig {
  mediaRef:    RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  markers:     Marker[];
  onMarkerClick: (t: number) => void;
  onScrubStart?: () => void;
}

function useScrubBar({ mediaRef, markers, onMarkerClick, onScrubStart }: ScrubBarConfig) {
  const trackRef    = useRef<HTMLDivElement>(null);
  const fillRef     = useRef<HTMLDivElement>(null);
  const bufferRef   = useRef<HTMLDivElement>(null);
  const thumbRef    = useRef<HTMLDivElement>(null);
  const tooltipRef  = useRef<HTMLDivElement>(null);
  const isDragging   = useRef(false);
  const rafId        = useRef<number | null>(null);
  const seekTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeekRatio = useRef<number | null>(null);

  const getRatio = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - left) / width));
  };

  // Atualiza visualmente a barra sem esperar o vídeo buscar
  const applyVisuals = (ratio: number) => {
    const pct = `${ratio * 100}%`;
    if (fillRef.current)  fillRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
    if (tooltipRef.current) {
      const m = mediaRef.current;
      if (m?.duration) tooltipRef.current.textContent = fmtTime(ratio * m.duration);
      tooltipRef.current.style.left = pct;
    }
  };

  const doSeek = (ratio: number, fast = false) => {
    const m = mediaRef.current;
    if (!m?.duration) return;
    const t = ratio * m.duration;
    if (fast && "fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
    else m.currentTime = t;
  };

  // Durante drag: fastSeek throttled a ~100 ms para não sobrecarregar com range requests.
  // O visual (fill + tooltip) atualiza a cada pointermove sem esperar o seek completar.
  const SEEK_INTERVAL_MS = 100;
  const scheduleDragSeek = (ratio: number) => {
    lastSeekRatio.current = ratio;
    if (seekTimer.current !== null) return; // já há um seek agendado
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      const r = lastSeekRatio.current;
      if (r === null || !isDragging.current) return;
      const m = mediaRef.current;
      if (!m?.duration) return;
      const t = r * m.duration;
      if ("fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
      else m.currentTime = t;
    }, SEEK_INTERVAL_MS);
  };

  const showThumb  = () => { if (thumbRef.current)  { thumbRef.current.style.opacity  = "1"; thumbRef.current.style.transform  = "translate(-50%,-50%) scale(1)"; } };
  const hideThumb  = () => { if (thumbRef.current)  { thumbRef.current.style.opacity  = "0"; } };
  const showTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "1"; };
  const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "0"; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    onScrubStart?.();
    showThumb();
    showTooltip();
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1.25)";
    const r = getRatio(e.clientX);
    applyVisuals(r);
    doSeek(r); // seek imediato no clique — sem fast (preciso)
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = getRatio(e.clientX);
    if (isDragging.current) {
      applyVisuals(r);
      scheduleDragSeek(r);
    } else {
      // hover: só tooltip
      if (tooltipRef.current) {
        const m = mediaRef.current;
        if (m?.duration) tooltipRef.current.textContent = fmtTime(r * m.duration);
        tooltipRef.current.style.left = `${r * 100}%`;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (rafId.current)   { cancelAnimationFrame(rafId.current); rafId.current = null; }
    if (seekTimer.current) { clearTimeout(seekTimer.current); seekTimer.current = null; }
    lastSeekRatio.current = null;
    const r = getRatio(e.clientX);
    applyVisuals(r);
    doSeek(r); // seek exato e preciso na soltura
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)";
    hideTooltip();
    hideThumb();
  };

  useEffect(() => () => {
    if (rafId.current)   cancelAnimationFrame(rafId.current);
    if (seekTimer.current) clearTimeout(seekTimer.current);
  }, []);

  const ScrubBar = (
    <div className="relative select-none" style={{ padding: "10px 0", cursor: "pointer", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={e => { if (!isDragging.current) { hideThumb(); hideTooltip(); } else onPointerUp(e as any); }}
      onPointerEnter={() => { if (!isDragging.current) { showThumb(); showTooltip(); } }}
    >
      {/* Track */}
      <div ref={trackRef} className="relative rounded-full" style={{ height: 4, background: "rgba(255,255,255,0.2)" }}>
        {/* Buffer (baixado) */}
        <div ref={bufferRef} className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: "0%", background: "rgba(255,255,255,0.35)", transition: "width 1s linear" }} />
        {/* Fill (posição atual) */}
        <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: "0%", background: "hsl(var(--primary))", transition: "none" }} />
        {/* Marcadores de revisão */}
        {markers.map((mk, i) => (
          <div key={i}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer z-10 group/mk flex items-center justify-center"
            style={{ left: `${(mk.timestampSec / (mediaRef.current?.duration || 1)) * 100}%`, width: 12, height: 20 }}
            onPointerDown={e => { e.stopPropagation(); onMarkerClick(mk.timestampSec); }}
          >
            <div className={`rounded-sm transition-transform group-hover/mk:scale-150
              ${mk.color === "amber" ? "bg-amber-400" : "bg-sky-400"}`}
              style={{ width: 3, height: 12 }} />
          </div>
        ))}
      </div>

      {/* Thumb (handle arrastável) */}
      <div ref={thumbRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 14, height: 14,
          top: "50%", left: "0%",
          transform: "translate(-50%,-50%)",
          background: "white",
          boxShadow: "0 1px 6px rgba(0,0,0,0.6)",
          opacity: 0,
          transition: "opacity 0.15s, transform 0.1s",
        }}
      />

      {/* Tooltip de tempo */}
      <div ref={tooltipRef}
        className="absolute pointer-events-none select-none"
        style={{
          bottom: "calc(100% + 12px)",
          left: "0%",
          transform: "translateX(-50%)",
          opacity: 0,
          transition: "opacity 0.12s",
          background: "rgba(0,0,0,0.88)",
          color: "#fff",
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
          padding: "3px 8px",
          borderRadius: 5,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
        }}
      >
        0:00.0
      </div>
    </div>
  );

  return { ScrubBar, fillRef, bufferRef, thumbRef, isDragging };
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

interface VideoPlayerProps {
  src: string;
  reviewMode: boolean;
  initialTime?: number;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[];
  onMarkerClick: (t: number) => void;
  onCapture: (time: number, dataUrl: string | null) => void;
}

function VideoPlayer({ src, reviewMode, initialTime, seekTo, markers, onMarkerClick, onCapture }: VideoPlayerProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const timeRef       = useRef<HTMLSpanElement>(null);
  const hideTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing,      setPlaying]      = useState(false);
  const [waiting,      setWaiting]      = useState(false);
  const [volume,       setVolume]       = useState(1);
  const [muted,        setMuted]        = useState(false);
  const [fullscreen,   setFullscreen]   = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [duration,     setDuration]     = useState(0);

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: videoRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers,
    onMarkerClick,
    onScrubStart: () => setShowControls(true),
  });

  useVideoSync({ mediaRef: videoRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, isDragging });

  // Eventos do vídeo
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay  = () => { setPlaying(true);  setWaiting(false); };
    const onPause = () => setPlaying(false);
    const onWait  = () => setWaiting(true);
    const onPlay2 = () => setWaiting(false);
    const onMeta  = () => setDuration(v.duration);
    const onVol   = () => { setVolume(v.volume); setMuted(v.muted); };
    const onFS    = () => setFullscreen(!!document.fullscreenElement);
    v.addEventListener("play",            onPlay);
    v.addEventListener("pause",           onPause);
    v.addEventListener("waiting",         onWait);
    v.addEventListener("playing",         onPlay2);
    v.addEventListener("canplay",         onPlay2);
    v.addEventListener("loadedmetadata",  onMeta);
    v.addEventListener("volumechange",    onVol);
    document.addEventListener("fullscreenchange", onFS);
    return () => {
      v.removeEventListener("play",           onPlay);
      v.removeEventListener("pause",          onPause);
      v.removeEventListener("waiting",        onWait);
      v.removeEventListener("playing",        onPlay2);
      v.removeEventListener("canplay",        onPlay2);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("volumechange",   onVol);
      document.removeEventListener("fullscreenchange", onFS);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [src]);

  // Seek para initialTime quando metadados carregarem
  useEffect(() => {
    if (!initialTime) return;
    const v = videoRef.current;
    if (!v) return;
    const go = () => { v.currentTime = initialTime; };
    v.addEventListener("loadedmetadata", go, { once: true });
    if (v.readyState >= 1) go();
    return () => v.removeEventListener("loadedmetadata", go);
  }, [initialTime, src]);

  // Seek externo (clique em marcador)
  useEffect(() => {
    if (!seekTo) return;
    const v = videoRef.current;
    if (v) v.currentTime = seekTo.t;
  }, [seekTo]);

  // Auto-hide controles
  const resetHide = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    if (!playing) { setShowControls(true); if (hideTimer.current) clearTimeout(hideTimer.current); }
    else resetHide();
  }, [playing, resetHide]);

  // Controles
  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); };
  const skip = (d: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
  };
  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / 30));
  };
  const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
  const setVol = (val: number) => {
    const v = videoRef.current;
    if (v) { v.volume = val; v.muted = val === 0; }
  };
  const toggleFS = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen();
  };
  const captureFrame = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      const scale = Math.min(1, 480 / (v.videoWidth || 480));
      const c = document.createElement("canvas");
      c.width  = (v.videoWidth  || 480) * scale;
      c.height = (v.videoHeight || 270) * scale;
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      onCapture(v.currentTime, c.toDataURL("image/jpeg", 0.8));
    } catch { onCapture(v.currentTime, null); }
  };

  const controlsVisible = showControls || !playing;

  return (
    <div ref={containerRef}
      className="relative w-full bg-black select-none overflow-hidden"
      style={{ cursor: controlsVisible ? "default" : "none" }}
      onMouseMove={resetHide}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
    >
      {/* Vídeo */}
      <video
        ref={videoRef}
        src={src}
        preload="auto"
        playsInline
        className="w-full block"
        style={fullscreen
          ? { width: "100%", height: "100vh", objectFit: "contain" }
          : { maxHeight: "calc(92vh - 240px)", minHeight: 220 }
        }
        onClick={togglePlay}
      />

      {/* Spinner de buffering */}
      {waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-9 w-9 text-white/70 animate-spin" />
        </div>
      )}

      {/* Ícone play central (apenas pausado) */}
      {!playing && !waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-16 w-16 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <Play className="h-7 w-7 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Overlay de controles */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
          transition: "opacity 0.25s",
        }}
      >
        {/* Gradiente */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 70%, transparent 100%)" }} />

        <div className="relative px-4 pb-3" style={{ paddingTop: 32 }}>
          {/* Scrub bar */}
          {ScrubBar}

          {/* Linha de controles */}
          <div className="flex items-center gap-2.5 mt-0.5">
            {/* Play/Pause */}
            <button onClick={togglePlay} className="text-white hover:text-white/80 shrink-0 transition-colors">
              {playing
                ? <Pause className="h-[18px] w-[18px] fill-white" />
                : <Play  className="h-[18px] w-[18px] fill-white ml-0.5" />
              }
            </button>

            {/* Pular ±10s */}
            <button onClick={() => skip(-10)} className="text-white/55 hover:text-white shrink-0 transition-colors">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={() => skip(10)} className="text-white/55 hover:text-white shrink-0 transition-colors">
              <SkipForward className="h-4 w-4" />
            </button>

            {/* Tempo */}
            <span ref={timeRef} className="shrink-0 tabular-nums"
              style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
              0:00.0 / 0:00.0
            </span>

            <div className="flex-1" />

            {/* Revisão: frame a frame + marcar */}
            {reviewMode && (
              <>
                <button onClick={() => stepFrame(-1)} title="Frame anterior"
                  className="shrink-0 flex items-center justify-center rounded transition-colors text-amber-300/80 hover:text-amber-100"
                  style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.3)", fontSize: 11, fontFamily: "monospace" }}>
                  ◀|
                </button>
                <button onClick={() => stepFrame(1)} title="Próximo frame"
                  className="shrink-0 flex items-center justify-center rounded transition-colors text-amber-300/80 hover:text-amber-100"
                  style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.3)", fontSize: 11, fontFamily: "monospace" }}>
                  |▶
                </button>
                <button onClick={captureFrame}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg text-white font-semibold transition-colors"
                  style={{ padding: "4px 10px", background: "#f59e0b", fontSize: 11 }}
                  onMouseOver={e => (e.currentTarget.style.background = "#d97706")}
                  onMouseOut={e  => (e.currentTarget.style.background = "#f59e0b")}
                >
                  <MapPin className="h-3 w-3" />Marcar frame
                </button>
              </>
            )}

            {/* Volume */}
            <button onClick={toggleMute} className="text-white/55 hover:text-white shrink-0 transition-colors">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
              onChange={e => setVol(+e.target.value)}
              className="shrink-0 cursor-pointer rounded-full"
              style={{ width: 60, height: 4, accentColor: "hsl(var(--primary))" }}
            />

            {/* Fullscreen */}
            <button onClick={toggleFS} className="text-white/55 hover:text-white shrink-0 transition-colors">
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AudioPlayer ───────────────────────────────────────────────────────────────

function AudioPlayer({
  src, fileName, reviewMode, seekTo, markers, onMarkerClick, onCapture,
}: {
  src: string; fileName: string; reviewMode: boolean;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[];
  onMarkerClick: (t: number) => void;
  onCapture: (time: number, dataUrl: string | null) => void;
}) {
  const audioRef   = useRef<HTMLAudioElement>(null);
  const timeRef    = useRef<HTMLSpanElement>(null);
  const [playing,  setPlaying]  = useState(false);
  const [volume,   setVolume]   = useState(1);
  const [muted,    setMuted]    = useState(false);

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: audioRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers, onMarkerClick,
  });

  useVideoSync({ mediaRef: audioRef as any, fillRef, bufferRef, thumbRef, timeDisplayRef: timeRef, isDragging });

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol   = () => { setVolume(a.volume); setMuted(a.muted); };
    a.addEventListener("play",  onPlay); a.addEventListener("pause", onPause); a.addEventListener("volumechange", onVol);
    return () => { a.removeEventListener("play", onPlay); a.removeEventListener("pause", onPause); a.removeEventListener("volumechange", onVol); };
  }, [src]);

  useEffect(() => {
    if (!seekTo) return;
    const a = audioRef.current;
    if (a) a.currentTime = seekTo.t;
  }, [seekTo]);

  const togglePlay = () => { const a = audioRef.current; if (a) a.paused ? a.play() : a.pause(); };
  const skip = (d: number) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + d)); };

  return (
    <div className="flex flex-col items-center gap-5 py-8 px-8 w-full max-w-xs">
      <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center"
        style={{ background: "hsl(var(--primary) / 0.12)", border: "1px solid hsl(var(--primary) / 0.2)" }}>
        <AudioLines className={`h-7 w-7 text-[hsl(var(--primary))] ${playing ? "animate-pulse" : ""}`} />
        {playing && <div className="absolute inset-0 rounded-2xl ring-2 ring-[hsl(var(--primary))]/25 animate-ping" />}
      </div>

      <p className="text-xs font-medium text-zinc-300 text-center truncate w-full">{fileName}</p>

      <div className="w-full">
        {ScrubBar}
        <span ref={timeRef} className="block text-right mt-1 tabular-nums"
          style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "ui-monospace, monospace" }}>
          0:00.0 / 0:00.0
        </span>
      </div>

      <div className="flex items-center gap-7">
        <button onClick={() => skip(-10)} className="flex flex-col items-center gap-0.5 transition-colors text-zinc-500 hover:text-zinc-200">
          <SkipBack className="h-4 w-4" /><span style={{ fontSize: 9 }}>-10s</span>
        </button>
        <button onClick={togglePlay}
          className="h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-all"
          style={{ background: "hsl(var(--primary))" }}
          onMouseOver={e => (e.currentTarget.style.filter = "brightness(0.9)")}
          onMouseOut={e  => (e.currentTarget.style.filter = "")}
        >
          {playing
            ? <Pause className="h-4 w-4 text-white fill-white" />
            : <Play  className="h-4 w-4 text-white fill-white ml-0.5" />
          }
        </button>
        <button onClick={() => skip(10)} className="flex flex-col items-center gap-0.5 transition-colors text-zinc-500 hover:text-zinc-200">
          <SkipForward className="h-4 w-4" /><span style={{ fontSize: 9 }}>+10s</span>
        </button>
      </div>

      {reviewMode && (
        <button onClick={() => { const a = audioRef.current; if (a) { a.pause(); onCapture(a.currentTime, null); } }}
          className="flex items-center gap-2 w-full justify-center text-white font-semibold rounded-xl transition-colors"
          style={{ padding: "8px 16px", background: "#f59e0b", fontSize: 12 }}>
          <MapPin className="h-3.5 w-3.5" />Marcar ponto
        </button>
      )}

      <div className="flex items-center gap-2 w-full">
        <button onClick={() => { const a = audioRef.current; if (a) a.muted = !a.muted; }}
          className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0">
          {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
          onChange={e => {
            const v = +e.target.value;
            const a = audioRef.current;
            if (a) { a.volume = v; a.muted = v === 0; }
          }}
          className="flex-1 cursor-pointer rounded-full"
          style={{ height: 4, accentColor: "hsl(var(--primary))" }}
        />
      </div>

      <audio ref={audioRef} src={src} preload="auto" />
    </div>
  );
}

// ── TaskFilesViewModal ────────────────────────────────────────────────────────

export function TaskFilesViewModal({
  open, onClose, taskId, taskCode, taskTitle,
  taskStatus, initialFileId, initialTime, onDone,
}: Props) {
  const { user } = useAuth();

  const [files,          setFiles]          = useState<TaskFile[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [selected,       setSelected]       = useState<TaskFile | null>(null);
  const [activeRev,      setActiveRev]      = useState<number>(0);
  const [reviewMode,     setReviewMode]     = useState(false);
  const [pendingComments,setPendingComments] = useState<PendingComment[]>([]);
  const [capturedFrame,  setCapturedFrame]  = useState<{ time: number; dataUrl: string | null } | null>(null);
  const [commentBody,    setCommentBody]    = useState("");
  const [submitting,     setSubmitting]     = useState(false);
  const [batchComments,  setBatchComments]  = useState<BatchComment[]>([]);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approving,      setApproving]      = useState(false);
  const [seekTarget,     setSeekTarget]     = useState<{ t: number; n: number } | null>(null);

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";
  const canAct        = isCoordinator && taskStatus === "review";
  const isInRevision  = taskStatus === "in_revision";

  useEffect(() => {
    if (!open) {
      setReviewMode(false); setPendingComments([]); setCapturedFrame(null);
      setConfirmApprove(false); setBatchComments([]);
      return;
    }
    setLoading(true);
    Promise.all([
      apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`),
      isInRevision
        ? apiFetch<{ comments: BatchComment[] }[]>(`/api/tasks/${taskId}/review-batches`)
            .then(bs => bs.length > 0 ? bs[bs.length - 1].comments : [] as BatchComment[])
            .catch(() => [] as BatchComment[])
        : Promise.resolve([] as BatchComment[]),
    ]).then(([f, bc]) => {
      setFiles(f); setBatchComments(bc);
      const target = initialFileId ? f.find(x => x.id === initialFileId) : null;
      const auto   = target ?? f[f.length - 1] ?? null;
      setSelected(auto); setActiveRev(auto?.revisionNumber ?? 0);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open, taskId, initialFileId, isInRevision]);

  const revisionGroups = useMemo(() => {
    const map = new Map<number, TaskFile[]>();
    files.forEach(f => {
      if (!map.has(f.revisionNumber)) map.set(f.revisionNumber, []);
      map.get(f.revisionNumber)!.push(f);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [files]);

  const activeFiles = useMemo(
    () => revisionGroups.find(([n]) => n === activeRev)?.[1] ?? [],
    [revisionGroups, activeRev]
  );

  const streamUrl   = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/stream` : `/api/tasks/${taskId}/files/${f.id}/stream`;
  const downloadUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/download` : `/api/tasks/${taskId}/files/${f.id}/download`;

  const isVideo = (f: TaskFile) => !!f.mimeType?.startsWith("video/");
  const isAudio = (f: TaskFile) => !!f.mimeType?.startsWith("audio/");
  const selectFile = (f: TaskFile) => { setSelected(f); setActiveRev(f.revisionNumber); };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const ids = files.map(f => f.id);
      if (ids.length) await apiPatch(`/api/tasks/${taskId}/files/approve`, { fileIds: ids });
      await apiPut(`/api/tasks/${taskId}`, { status: "completed" });
      toast.success("Tarefa aprovada"); onDone?.(); onClose();
    } catch { toast.error("Erro ao aprovar"); }
    finally { setApproving(false); setConfirmApprove(false); }
  };

  const handleCapture = useCallback((time: number, dataUrl: string | null) => {
    setCapturedFrame({ time, dataUrl }); setCommentBody("");
  }, []);

  const saveComment = () => {
    if (!commentBody.trim() || !capturedFrame) return;
    setPendingComments(prev => [...prev, {
      localId: crypto.randomUUID(), timestampSec: capturedFrame.time,
      orderIndex: prev.length + 1, body: commentBody.trim(),
      thumbnailDataUrl: capturedFrame.dataUrl,
    }]);
    setCapturedFrame(null); setCommentBody("");
  };

  const removeComment = (id: string) =>
    setPendingComments(prev =>
      prev.filter(c => c.localId !== id).map((c, i) => ({ ...c, orderIndex: i + 1 }))
    );

  const handleMarkerClick = (t: number) =>
    setSeekTarget(prev => ({ t, n: (prev?.n ?? 0) + 1 }));

  const handleSubmitBatch = async () => {
    if (!pendingComments.length || !selected) return;
    setSubmitting(true);
    try {
      await apiPost(`/api/tasks/${taskId}/review-batches`, {
        taskFileId: selected.id,
        comments: pendingComments.map(c => ({
          timestampSec: c.timestampSec, orderIndex: c.orderIndex,
          body: c.body, thumbnailDataUrl: c.thumbnailDataUrl ?? undefined,
        })),
      });
      toast.success(`Revisão enviada — ${pendingComments.length} comentário${pendingComments.length > 1 ? "s" : ""}`);
      onDone?.(); onClose();
    } catch { toast.error("Erro ao enviar revisão"); }
    finally { setSubmitting(false); }
  };

  const hasMedia   = files.some(f => isVideo(f) || isAudio(f));
  const allMarkers: Marker[] = [
    ...pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "amber" as const })),
    ...batchComments.map(c  => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "sky"   as const })),
  ];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden rounded-2xl max-h-[92vh] flex flex-col bg-[hsl(var(--card))] border border-[hsl(var(--border))]">

        {/* Header */}
        <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-2 border-b border-[hsl(var(--border))]">
          <DialogTitle className="flex-1 min-w-0 text-left">
            <div className="flex items-baseline gap-2 min-w-0">
              {taskCode && <span className="shrink-0 font-mono text-xs font-semibold tracking-tight text-[hsl(var(--primary))]/60">{taskCode}</span>}
              <span className="text-sm font-semibold truncate text-[hsl(var(--foreground))]">{taskTitle}</span>
            </div>
          </DialogTitle>

          {canAct && !loading && hasMedia && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setReviewMode(v => !v); setPendingComments([]); setCapturedFrame(null); setConfirmApprove(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${reviewMode
                    ? "bg-amber-500 text-white"
                    : "border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-amber-400 hover:text-amber-600"
                  }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${reviewMode ? "bg-white animate-pulse" : "bg-current opacity-40"}`} />
                {reviewMode ? "Revisando" : "Revisar"}
              </button>

              {!reviewMode && (confirmApprove ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">Confirmar?</span>
                  <button onClick={handleApprove} disabled={approving}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60">
                    <CheckCircle className="h-3.5 w-3.5" />{approving ? "Aprovando…" : "Sim"}
                  </button>
                  <button onClick={() => setConfirmApprove(false)}
                    className="px-2 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Não</button>
                </div>
              ) : (
                <button onClick={() => setConfirmApprove(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
                  <CheckCircle className="h-3.5 w-3.5" />Aprovar
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conteúdo */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 text-[hsl(var(--primary))] animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Clapperboard className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum arquivo enviado</p>
          </div>
        ) : (
          <>
            {/* Player */}
            <div className="bg-black flex items-center justify-center shrink-0 relative">
              {selected && isVideo(selected) && (
                <VideoPlayer key={selected.id} src={streamUrl(selected)}
                  reviewMode={reviewMode}
                  initialTime={selected.id === initialFileId ? initialTime : undefined}
                  seekTo={seekTarget} markers={allMarkers}
                  onMarkerClick={handleMarkerClick} onCapture={handleCapture}
                />
              )}
              {selected && isAudio(selected) && (
                <AudioPlayer key={selected.id} src={streamUrl(selected)}
                  fileName={selected.fileName} reviewMode={reviewMode}
                  seekTo={seekTarget} markers={allMarkers}
                  onMarkerClick={handleMarkerClick} onCapture={handleCapture}
                />
              )}

              {/* Card de comentário de frame */}
              {capturedFrame && (
                <div className="absolute inset-0 flex items-center justify-center z-20"
                  style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}>
                  <div className="bg-[hsl(var(--card))] rounded-2xl overflow-hidden w-80 shadow-2xl border border-[hsl(var(--border))]">
                    {capturedFrame.dataUrl
                      ? <img src={capturedFrame.dataUrl} alt="frame" className="w-full block" />
                      : <div className="w-full h-20 bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                          <AudioLines className="h-6 w-6 text-[hsl(var(--muted-foreground))]/30" />
                        </div>
                    }
                    <div className="p-3 space-y-2.5">
                      <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">⏱ {fmtTime(capturedFrame.time)}</p>
                      <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)}
                        onKeyDown={e => { if (e.key === "Escape") setCapturedFrame(null); }}
                        placeholder="Descreva o que precisa ser alterado…"
                        className="w-full text-sm resize-none border border-[hsl(var(--border))] rounded-xl p-2.5 bg-[hsl(var(--muted))]/30 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                        rows={3} autoFocus />
                      <div className="flex gap-2">
                        <button onClick={() => setCapturedFrame(null)}
                          className="flex-1 py-2 rounded-xl border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Cancelar</button>
                        <button onClick={saveComment} disabled={!commentBody.trim()}
                          className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-40">Salvar comentário</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Comentários existentes — editor lê */}
            {!reviewMode && batchComments.length > 0 && (
              <div className="shrink-0 border-t border-sky-200/40 dark:border-sky-800/30 bg-sky-50/30 dark:bg-sky-950/10 max-h-48 overflow-y-auto">
                <div className="px-4 pt-2.5 pb-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  <p className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 uppercase tracking-wide">
                    {batchComments.length} alteração{batchComments.length > 1 ? "ões" : ""} solicitada{batchComments.length > 1 ? "s" : ""}
                  </p>
                </div>
                {batchComments.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-sky-200/20 dark:border-sky-800/15">
                    <span className="shrink-0 text-[10px] font-bold text-sky-500 mt-1 w-4 tabular-nums">{c.orderIndex}</span>
                    {c.frameThumbnail
                      ? <button onClick={() => handleMarkerClick(c.timestampSec)} className="shrink-0 group">
                          <img src={c.frameThumbnail} className="h-10 w-[72px] rounded-md object-cover ring-1 ring-sky-400/30 group-hover:ring-sky-400 transition-all" />
                        </button>
                      : <button onClick={() => handleMarkerClick(c.timestampSec)}
                          className="shrink-0 h-10 w-[72px] rounded-md bg-sky-100 dark:bg-sky-950/30 border border-sky-300/40 flex items-center justify-center text-[9px] font-mono text-sky-600 hover:bg-sky-200/60">
                          {fmtTime(c.timestampSec)}
                        </button>
                    }
                    <p className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))]/80 leading-snug pt-0.5">{c.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Painel revisão — comentários pendentes */}
            {reviewMode && (
              <div className="shrink-0 border-t border-amber-200/40 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10 max-h-44 overflow-y-auto">
                {pendingComments.length === 0 ? (
                  <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))]/50 py-5 px-4">
                    Pause o vídeo e clique em <span className="font-medium text-amber-600 dark:text-amber-400">Marcar frame</span>
                  </p>
                ) : pendingComments.map((c, i) => (
                  <div key={c.localId} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-amber-200/20 dark:border-amber-800/15 first:border-t-0">
                    <span className="shrink-0 text-[10px] font-bold text-amber-600 mt-1 w-4 tabular-nums">{i + 1}</span>
                    {c.thumbnailDataUrl && (
                      <button onClick={() => handleMarkerClick(c.timestampSec)} className="shrink-0 group">
                        <img src={c.thumbnailDataUrl} className="h-10 w-[72px] rounded-md object-cover ring-1 ring-amber-400/30 group-hover:ring-amber-400 transition-all" />
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mb-0.5">{fmtTime(c.timestampSec)}</p>
                      <p className="text-xs text-[hsl(var(--foreground))]/80 leading-snug line-clamp-2">{c.body}</p>
                    </div>
                    <button onClick={() => removeComment(c.localId)}
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Barra de envio */}
            {reviewMode && pendingComments.length > 0 && (
              <div className="shrink-0 px-4 py-2.5 border-t border-amber-300/40 flex items-center justify-between bg-amber-50/60 dark:bg-amber-950/20">
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {pendingComments.length} comentário{pendingComments.length > 1 ? "s" : ""} prontos
                </span>
                <button onClick={handleSubmitBatch} disabled={submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-60">
                  <Send className="h-3.5 w-3.5" />{submitting ? "Enviando…" : "Enviar revisão"}
                </button>
              </div>
            )}

            {/* Info bar */}
            {selected && (
              <div className="shrink-0 px-4 py-2 border-t border-[hsl(var(--border))] flex items-center gap-3 bg-[hsl(var(--muted))]/30">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[hsl(var(--foreground))] truncate">{selected.fileName}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    {[selected.uploaderName?.split(" ")[0], fmtDate(selected.createdAt), fmtSize(selected.fileSize)].filter(Boolean).join(" · ")}
                    {selected.approvedAt && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">· ✓ {selected.approvedByName?.split(" ")[0] ?? "Aprovado"}</span>}
                  </p>
                </div>
                <a href={downloadUrl(selected)} download={selected.fileName}
                  className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
                  <Download className="h-3.5 w-3.5" />Baixar
                </a>
              </div>
            )}

            {/* Histórico de versões */}
            <div className="shrink-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
              <div className="flex items-center gap-1 px-4 pt-3 pb-2 overflow-x-auto scrollbar-none">
                {revisionGroups.map(([revNum, revFiles], idx) => {
                  const isActive   = activeRev === revNum;
                  const isApproved = revFiles.some(f => f.approvedAt);
                  return (
                    <div key={revNum} className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setActiveRev(revNum); setSelected(revFiles[revFiles.length - 1]); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                          ${isActive
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                            : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                          }`}
                      >
                        {revLabel(revNum)}
                        {isApproved && <CheckCircle2 className={`h-3 w-3 shrink-0 ${isActive ? "opacity-80" : "text-emerald-500"}`} />}
                      </button>
                      {idx < revisionGroups.length - 1 && <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/30 shrink-0" />}
                    </div>
                  );
                })}
              </div>
              <div className="px-4 pb-3 space-y-1">
                {activeFiles.map(f => (
                  <button key={f.id} onClick={() => selectFile(f)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors
                      ${f.id === selected?.id
                        ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20"
                        : "hover:bg-[hsl(var(--muted))]/50 border border-transparent"
                      }`}
                  >
                    {isVideo(f)
                      ? <Clapperboard className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                      : <AudioLines  className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                    }
                    <span className={`text-[11px] font-medium truncate flex-1 ${f.id === selected?.id ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>
                      {f.fileName}
                    </span>
                    {f.approvedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
