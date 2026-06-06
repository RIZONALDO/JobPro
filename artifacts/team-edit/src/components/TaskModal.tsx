import {
  useEffect, useState, useMemo, useRef, useCallback,
  type RefObject,
} from "react";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { fmtDate } from "@/lib/utils";
import {
  Clock, FolderOpen, Copy, Tag,
  Film, Music, Download, Link2, Trash2, FileVideo,
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, MapPin, Send, X, CheckCircle, CheckCircle2,
  Loader2, Clapperboard, AudioLines, ChevronRight, RotateCcw,
  Package, ClipboardCheck, Share2, ExternalLink,
} from "lucide-react";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "entrega" | "revisao" | "envio";

interface Person { id: number; name: string; avatarUrl?: string | null; }
interface Revision { id: number; revisionNumber: number; comment: string; createdAt: string; }
interface FrameComment {
  id: number; timestampSec: number; orderIndex: number;
  frameThumbnail: string | null; body: string;
}
interface ReviewBatch {
  id: number; taskFileId: number | null; revisionNumber: number;
  commentCount: number; submittedAt: string; submittedByName: string | null;
  comments: FrameComment[];
}
interface TaskFile {
  id: number; fileName: string; fileSize: number | null; mimeType: string | null;
  publicToken: string | null; revisionNumber: number; createdAt: string;
  uploaderName: string | null; approvedAt?: string | null; approvedByName?: string | null;
}
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string; priority: string;
  complexity: string; dueDate: string | null; startDate?: string | null;
  folderUrl: string | null; revisionCount: number; notes?: string | null;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  revisions: Revision[]; createdAt: string; updatedAt: string;
  taskType: string;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}
interface PendingComment {
  localId: string; timestampSec: number; orderIndex: number;
  body: string; thumbnailDataUrl: string | null;
}
interface Marker { timestampSec: number; orderIndex: number; color: "amber" | "sky"; }

interface Props {
  taskId: number; onClose: () => void;
  onOpenTask?: (id: number) => void;
  initialTab?: Tab;
  onDone?: () => void;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

const fmtSize = (b: number | null) =>
  !b ? "" : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const fmtTime = (s: number): string => {
  if (!s || !isFinite(s) || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

const revLabel = (n: number) => (n === 0 ? "Original" : `${n}ª alt.`);

// ── useVideoSync ──────────────────────────────────────────────────────────────

interface VideoSyncConfig {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  fillRef: RefObject<HTMLDivElement | null>;
  bufferRef: RefObject<HTMLDivElement | null>;
  thumbRef: RefObject<HTMLDivElement | null>;
  timeDisplayRef: RefObject<HTMLSpanElement | null>;
  isDragging: RefObject<boolean>;
}

function useVideoSync({ mediaRef, fillRef, bufferRef, thumbRef, timeDisplayRef, isDragging }: VideoSyncConfig) {
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

function useScrubBar({ mediaRef, markers, onMarkerClick, onScrubStart }: ScrubBarConfig) {
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
  const doSeek = (r: number, fast = false) => {
    const m = mediaRef.current; if (!m?.duration) return;
    const t = r * m.duration;
    if (fast && "fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
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
  const showTip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "1"; };
  const hideTip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "0"; };

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
            <div className={`rounded-sm transition-transform group-hover/mk:scale-150 ${mk.color === "amber" ? "bg-amber-400" : "bg-sky-400"}`} style={{ width: 3, height: 12 }} />
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

function VideoPlayer({ src, reviewMode, initialTime, seekTo, markers, onMarkerClick, onCapture, compact }: {
  src: string; reviewMode: boolean; initialTime?: number; compact?: boolean;
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

  const togglePlay = () => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); };
  const skip = (d: number) => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const stepFrame = (dir: 1 | -1) => { const v = videoRef.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / 30)); };
  const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
  const setVol = (val: number) => { const v = videoRef.current; if (v) { v.volume = val; v.muted = val === 0; } };
  const toggleFS = () => { if (document.fullscreenElement) document.exitFullscreen(); else containerRef.current?.requestFullscreen(); };
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
  const maxH = compact ? "38vh" : "45vh";

  return (
    <div ref={containerRef} className="relative w-full bg-black select-none overflow-hidden"
      style={{ cursor: ctrlVisible ? "default" : "none" }}
      onMouseMove={resetHide} onMouseLeave={() => { if (playing) setShowControls(false); }}>
      <video ref={videoRef} src={src} preload="auto" playsInline className="w-full block"
        style={fullscreen ? { width: "100%", height: "100vh", objectFit: "contain" } : { maxHeight: maxH, minHeight: 180 }}
        onClick={togglePlay} />
      {waiting && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="h-8 w-8 text-white/70 animate-spin" /></div>}
      {!playing && !waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ opacity: ctrlVisible ? 1 : 0, pointerEvents: ctrlVisible ? "auto" : "none", transition: "opacity 0.25s" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }} />
        <div className="relative px-4 pb-3" style={{ paddingTop: 28 }}>
          {ScrubBar}
          <div className="flex items-center gap-2.5 mt-0.5">
            <button onClick={togglePlay} className="text-white hover:text-white/80 shrink-0">
              {playing ? <Pause className="h-[17px] w-[17px] fill-white" /> : <Play className="h-[17px] w-[17px] fill-white ml-0.5" />}
            </button>
            <button onClick={() => skip(-10)} className="text-white/55 hover:text-white shrink-0"><SkipBack className="h-4 w-4" /></button>
            <button onClick={() => skip(10)} className="text-white/55 hover:text-white shrink-0"><SkipForward className="h-4 w-4" /></button>
            <span ref={timeRef} className="shrink-0 tabular-nums" style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "ui-monospace,monospace" }}>0:00 / 0:00</span>
            <div className="flex-1" />
            {reviewMode && <>
              <button onClick={() => stepFrame(-1)} className="shrink-0 flex items-center justify-center rounded text-amber-300/80 hover:text-amber-100" style={{ width: 26, height: 26, border: "1px solid rgba(251,191,36,0.3)", fontSize: 10, fontFamily: "monospace" }}>◀|</button>
              <button onClick={() => stepFrame(1)} className="shrink-0 flex items-center justify-center rounded text-amber-300/80 hover:text-amber-100" style={{ width: 26, height: 26, border: "1px solid rgba(251,191,36,0.3)", fontSize: 10, fontFamily: "monospace" }}>|▶</button>
              <button onClick={captureFrame} className="shrink-0 flex items-center gap-1 rounded-lg text-white font-semibold" style={{ padding: "3px 9px", background: "#f59e0b", fontSize: 11 }}
                onMouseOver={e => (e.currentTarget.style.background = "#d97706")} onMouseOut={e => (e.currentTarget.style.background = "#f59e0b")}>
                <MapPin className="h-3 w-3" />Marcar
              </button>
            </>}
            <button onClick={toggleMute} className="text-white/55 hover:text-white shrink-0">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={e => setVol(+e.target.value)}
              className="shrink-0 cursor-pointer" style={{ width: 56, height: 4, accentColor: "hsl(var(--primary))" }} />
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

function AudioPlayer({ src, fileName, reviewMode, seekTo, markers, onMarkerClick, onCapture }: {
  src: string; fileName: string; reviewMode: boolean;
  seekTo?: { t: number; n: number } | null;
  markers: Marker[]; onMarkerClick: (t: number) => void;
  onCapture: (time: number, dataUrl: string | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({ mediaRef: audioRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>, markers, onMarkerClick });
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
    <div className="flex flex-col items-center gap-4 py-6 px-8 w-full max-w-xs mx-auto">
      <div className="relative h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "hsl(var(--primary)/0.12)", border: "1px solid hsl(var(--primary)/0.2)" }}>
        <AudioLines className={`h-6 w-6 text-[hsl(var(--primary))] ${playing ? "animate-pulse" : ""}`} />
        {playing && <div className="absolute inset-0 rounded-2xl ring-2 ring-[hsl(var(--primary))]/25 animate-ping" />}
      </div>
      <p className="text-xs text-zinc-300 text-center truncate w-full">{fileName}</p>
      <div className="w-full">
        {ScrubBar}
        <span ref={timeRef} className="block text-right mt-1 tabular-nums" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "ui-monospace,monospace" }}>0:00 / 0:00</span>
      </div>
      <div className="flex items-center gap-6">
        <button onClick={() => skip(-10)} className="flex flex-col items-center gap-0.5 text-zinc-500 hover:text-zinc-200"><SkipBack className="h-4 w-4" /><span style={{ fontSize: 9 }}>-10s</span></button>
        <button onClick={togglePlay} className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>
          {playing ? <Pause className="h-4 w-4 text-white fill-white" /> : <Play className="h-4 w-4 text-white fill-white ml-0.5" />}
        </button>
        <button onClick={() => skip(10)} className="flex flex-col items-center gap-0.5 text-zinc-500 hover:text-zinc-200"><SkipForward className="h-4 w-4" /><span style={{ fontSize: 9 }}>+10s</span></button>
      </div>
      {reviewMode && (
        <button onClick={() => { const a = audioRef.current; if (a) { a.pause(); onCapture(a.currentTime, null); } }}
          className="flex items-center gap-2 w-full justify-center text-white font-semibold rounded-xl" style={{ padding: "7px 14px", background: "#f59e0b", fontSize: 12 }}>
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

// ── TaskModal ─────────────────────────────────────────────────────────────────

export function TaskModal({ taskId, onClose, onOpenTask, initialTab = "entrega", onDone }: Props) {
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [sharing, setSharing] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Player state
  const [selected, setSelected] = useState<TaskFile | null>(null);
  const [activeRev, setActiveRev] = useState<number>(0);
  const [seekTarget, setSeekTarget] = useState<{ t: number; n: number } | null>(null);
  const [seekInit, setSeekInit] = useState<{ fileId: number | null; time: number } | null>(null);

  // Revisão state
  type Decision = "idle" | "revise" | "approve";
  const [decision, setDecision] = useState<Decision>("idle");
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [capturedFrame, setCapturedFrame] = useState<{ time: number; dataUrl: string | null } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${taskId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`).catch(() => [] as TaskFile[]),
      apiFetch<ReviewBatch[]>(`/api/tasks/${taskId}/review-batches`).catch(() => [] as ReviewBatch[]),
    ]).then(([t, f, b]) => {
      setTask(t); setFiles(f); setBatches(b);
      if (f.length > 0 && !selected) {
        const last = f[f.length - 1];
        setSelected(last); setActiveRev(last.revisionNumber);
      }
    }).catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // Navega para aba Entrega com seek quando vem do histórico
  useEffect(() => {
    if (!seekInit) return;
    const f = files.find(x => x.id === seekInit.fileId);
    if (f) { setSelected(f); setActiveRev(f.revisionNumber); }
    setSeekTarget(prev => ({ t: seekInit.time, n: (prev?.n ?? 0) + 1 }));
    setSeekInit(null);
  }, [seekInit, files]);

  const streamUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/stream` : `/api/tasks/${taskId}/files/${f.id}/stream`;
  const downloadUrl = (f: TaskFile) =>
    f.publicToken ? `/api/public/${f.publicToken}/download` : `/api/tasks/${taskId}/files/${f.id}/download`;
  const isVideo = (f: TaskFile) => !!f.mimeType?.startsWith("video/");
  const isAudio = (f: TaskFile) => !!f.mimeType?.startsWith("audio/");

  const revisionGroups = useMemo(() => {
    const map = new Map<number, TaskFile[]>();
    files.forEach(f => { if (!map.has(f.revisionNumber)) map.set(f.revisionNumber, []); map.get(f.revisionNumber)!.push(f); });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [files]);

  const activeFiles = useMemo(() => revisionGroups.find(([n]) => n === activeRev)?.[1] ?? [], [revisionGroups, activeRev]);

  // Marcadores no scrubber: amber = pendentes, sky = revisões anteriores
  const allMarkers: Marker[] = useMemo(() => [
    ...pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "amber" as const })),
    ...batches.flatMap(b => b.comments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "sky" as const }))),
  ], [pendingComments, batches]);

  const handleCapture = useCallback((time: number, dataUrl: string | null) => {
    setCapturedFrame({ time, dataUrl }); setCommentBody("");
  }, []);
  const saveComment = () => {
    if (!commentBody.trim() || !capturedFrame) return;
    setPendingComments(prev => [...prev, { localId: crypto.randomUUID(), timestampSec: capturedFrame.time, orderIndex: prev.length + 1, body: commentBody.trim(), thumbnailDataUrl: capturedFrame.dataUrl }]);
    setCapturedFrame(null); setCommentBody("");
  };
  const removeComment = (id: string) =>
    setPendingComments(prev => prev.filter(c => c.localId !== id).map((c, i) => ({ ...c, orderIndex: i + 1 })));
  const handleMarkerClick = (t: number) => setSeekTarget(prev => ({ t, n: (prev?.n ?? 0) + 1 }));

  const handleSubmitBatch = async () => {
    if (!pendingComments.length || !selected) return;
    setSubmitting(true);
    try {
      await apiPost(`/api/tasks/${taskId}/review-batches`, {
        taskFileId: selected.id,
        comments: pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, body: c.body, thumbnailDataUrl: c.thumbnailDataUrl ?? undefined })),
      });
      toast.success(`Revisão enviada — ${pendingComments.length} comentário${pendingComments.length > 1 ? "s" : ""}`);
      onDone?.(); onClose();
    } catch { toast.error("Erro ao enviar revisão"); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const ids = files.map(f => f.id);
      if (ids.length) await apiPatch(`/api/tasks/${taskId}/files/approve`, { fileIds: ids });
      await apiPut(`/api/tasks/${taskId}`, { status: "completed" });
      toast.success("Tarefa aprovada!"); onDone?.(); onClose();
    } catch { toast.error("Erro ao aprovar"); }
    finally { setApproving(false); }
  };

  const generateLink = async (fileId: number) => {
    setSharing(fileId);
    try {
      const { token } = await apiPost<{ token: string }>(`/api/tasks/${taskId}/files/${fileId}/share`, {});
      const url = `${window.location.origin}/p/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: token } : f));
    } catch { toast.error("Erro ao gerar link"); }
    finally { setSharing(null); }
  };

  const removeFile = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success("Arquivo removido");
    } catch { toast.error("Erro ao remover arquivo"); }
  };

  const canReview = isCoordinator && task?.status === "review";
  const isApproved = task?.status === "completed";
  const hasMedia = files.some(f => isVideo(f) || isAudio(f));

  // Tabs disponíveis para o coordenador
  const tabs: { id: Tab; icon: React.ReactNode; label: string; disabled?: boolean }[] = isCoordinator ? [
    { id: "entrega", icon: <Package className="h-3.5 w-3.5" />, label: "Entrega" },
    { id: "revisao", icon: <ClipboardCheck className="h-3.5 w-3.5" />, label: "Revisão" },
    { id: "envio", icon: <Share2 className="h-3.5 w-3.5" />, label: "Envio ao cliente", disabled: !isApproved && task?.status !== "completed" },
  ] : [
    { id: "entrega", icon: <Package className="h-3.5 w-3.5" />, label: "Material entregue" },
  ];

  // Arquivo aprovado (para aba Envio)
  const approvedFile = files.find(f => f.approvedAt) ?? files[files.length - 1] ?? null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100vw-16px)] p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col rounded-2xl border border-[hsl(var(--border))] shadow-2xl bg-[hsl(var(--card))]">

        {loading || !task ? (
          <>
            <DialogTitle className="sr-only">Carregando</DialogTitle>
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[hsl(var(--primary))]/20 border-t-[hsl(var(--primary))] animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Carregando…</span>
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{task.title}</DialogTitle>

            {/* ── HEADER compacto ── */}
            <div className="shrink-0 px-5 pt-4 pb-0 border-b border-[hsl(var(--border))]">
              <div className="flex items-start gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {task.taskCode && <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span>}
                    <h2 className="text-base font-bold text-[hsl(var(--foreground))] leading-snug">{task.title}</h2>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none ${STATUS_CHIP[task.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    <MultiTaskBadge taskType={task.taskType} />
                    {task.revisionCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30">
                        <RotateCcw className="h-2.5 w-2.5" />{task.revisionCount} alt.
                      </span>
                    )}
                    {task.client && <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1"><Tag className="h-3 w-3" />{task.client}</span>}
                    {task.editors?.[0] && <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1.5"><AvatarDisplay name={task.editors[0].name} avatarUrl={task.editors[0].avatarUrl} size={14} />{task.editors[0].name.split(" ")[0]}</span>}
                    {task.dueDate && <span className="text-[11px] text-[hsl(var(--muted-foreground))]/50 flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(task.dueDate)}</span>}
                  </div>
                </div>
              </div>

              {/* Tab bar */}
              <div className="flex -mb-px">
                {tabs.map(tab => (
                  <button key={tab.id} onClick={() => !tab.disabled && setActiveTab(tab.id)} disabled={tab.disabled}
                    className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold border-b-2 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                      activeTab === tab.id
                        ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))]"
                    }`}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── CONTEÚDO ── */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ══════════════════════════════════════════════════
                  TAB 1 — ENTREGA
                  "O que o editor me mandou"
              ══════════════════════════════════════════════════ */}
              {activeTab === "entrega" && (
                <>
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
                      <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--muted))]/40 flex items-center justify-center">
                        <Package className="h-6 w-6 text-[hsl(var(--muted-foreground))]/30" />
                      </div>
                      <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Aguardando entrega do editor</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]/50">O editor ainda não enviou arquivos para esta tarefa.</p>
                    </div>
                  ) : (
                    <>
                      {/* Player — só visualização */}
                      <div className="bg-black relative">
                        {selected && isVideo(selected) && (
                          <VideoPlayer key={selected.id} src={streamUrl(selected)} reviewMode={false}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick}
                            onCapture={() => {}} />
                        )}
                        {selected && isAudio(selected) && (
                          <AudioPlayer key={selected.id} src={streamUrl(selected)} fileName={selected.fileName} reviewMode={false}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick} onCapture={() => {}} />
                        )}
                      </div>

                      {/* Info do arquivo + download */}
                      {selected && (
                        <div className="px-4 py-2.5 border-b border-[hsl(var(--border))] flex items-center gap-3 bg-[hsl(var(--muted))]/20">
                          <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            {isVideo(selected) ? <Film className="h-3.5 w-3.5 text-violet-500" /> : <Music className="h-3.5 w-3.5 text-violet-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{selected.fileName}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                              {[selected.uploaderName?.split(" ")[0], fmtDate(selected.createdAt), fmtSize(selected.fileSize)].filter(Boolean).join(" · ")}
                              {selected.approvedAt && <span className="ml-1.5 text-emerald-500 font-medium">· ✓ Aprovado</span>}
                            </p>
                          </div>
                          <a href={downloadUrl(selected)} download={selected.fileName}
                            className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors">
                            <Download className="h-3.5 w-3.5" />Baixar
                          </a>
                          <button onClick={() => removeFile(selected.id)} className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Seletor de versão */}
                      <div className="border-b border-[hsl(var(--border))]">
                        <div className="flex items-center gap-1 px-4 pt-2.5 pb-2 overflow-x-auto scrollbar-none">
                          {revisionGroups.map(([revNum, revFiles], idx) => {
                            const isActive = activeRev === revNum;
                            const approved = revFiles.some(f => f.approvedAt);
                            return (
                              <div key={revNum} className="flex items-center gap-1 shrink-0">
                                <button onClick={() => { setActiveRev(revNum); setSelected(revFiles[revFiles.length - 1]); }}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
                                  {revLabel(revNum)}
                                  {approved && <CheckCircle2 className={`h-3 w-3 ${isActive ? "opacity-80" : "text-emerald-500"}`} />}
                                </button>
                                {idx < revisionGroups.length - 1 && <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/30" />}
                              </div>
                            );
                          })}
                        </div>
                        <div className="px-4 pb-2.5 space-y-1">
                          {activeFiles.map(f => (
                            <button key={f.id} onClick={() => { setSelected(f); setActiveRev(f.revisionNumber); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left transition-colors ${f.id === selected?.id ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20" : "hover:bg-[hsl(var(--muted))]/50 border border-transparent"}`}>
                              {isVideo(f) ? <Clapperboard className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                                : <AudioLines className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />}
                              <span className={`text-[11px] font-medium truncate flex-1 ${f.id === selected?.id ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>{f.fileName}</span>
                              {f.approvedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Pedidos anteriores de alteração */}
                      {batches.length > 0 && (
                        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Pedidos de alteração anteriores</p>
                          <div className="space-y-3">
                            {batches.map(batch => (
                              <div key={batch.id} className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                                <div className="px-3 py-2 bg-[hsl(var(--muted))]/30 flex items-center gap-2">
                                  <span className="h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-950/50 border border-amber-300/70 dark:border-amber-700/60 flex items-center justify-center text-[10px] font-bold text-amber-600 shrink-0">{batch.revisionNumber}</span>
                                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{batch.revisionNumber}ª alteração solicitada</span>
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]/40 ml-auto">{fmtDate(batch.submittedAt)}</span>
                                </div>
                                {batch.comments.map((fc, ci) => (
                                  <button key={fc.id} onClick={() => { setSeekInit({ fileId: batch.taskFileId, time: fc.timestampSec }); }}
                                    className={`w-full flex items-start gap-2.5 px-3 py-2 hover:bg-[hsl(var(--muted))]/40 transition-colors text-left ${ci > 0 ? "border-t border-[hsl(var(--border))]" : ""}`}>
                                    <span className="shrink-0 text-[10px] font-bold text-amber-500 mt-0.5 w-4 tabular-nums">{fc.orderIndex}</span>
                                    {fc.frameThumbnail
                                      ? <img src={fc.frameThumbnail} className="h-9 w-[64px] rounded object-cover shrink-0" />
                                      : <span className="shrink-0 h-9 w-[64px] rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200/40 flex items-center justify-center text-[9px] font-mono text-amber-600">{fmtTime(fc.timestampSec)}</span>
                                    }
                                    <p className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))]/80 leading-snug pt-0.5">{fc.body}</p>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Direcionamento original */}
                      {task.description && (
                        <div className="px-4 py-3">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Direcionamento original</p>
                          <p className="text-xs text-[hsl(var(--foreground))]/70 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ══════════════════════════════════════════════════
                  TAB 2 — REVISÃO
                  "Vou aprovar ou pedir alteração"
              ══════════════════════════════════════════════════ */}
              {activeTab === "revisao" && (
                <>
                  {!canReview && !isApproved ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
                      <ClipboardCheck className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" />
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">
                        {task.status === "in_revision" ? "Aguardando nova entrega do editor" : "A tarefa não está em fase de revisão"}
                      </p>
                    </div>
                  ) : isApproved ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
                      <div className="h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                        <CheckCircle className="h-7 w-7 text-emerald-500" />
                      </div>
                      <p className="text-base font-semibold text-[hsl(var(--foreground))]">Aprovado</p>
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">Esta tarefa foi aprovada e concluída.</p>
                    </div>
                  ) : decision === "idle" ? (
                    /* Decisão inicial */
                    <div className="p-6">
                      <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]/60 uppercase tracking-widest mb-5">O material está aprovado?</p>
                      <div className="grid grid-cols-2 gap-4">
                        {/* Card Aprovar */}
                        <button onClick={() => setDecision("approve")}
                          className="group flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-[hsl(var(--border))] hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-all">
                          <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <CheckCircle className="h-7 w-7 text-emerald-500" />
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-sm text-[hsl(var(--foreground))]">Aprovar</p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60 mt-1">Tarefa concluída, material aceito</p>
                          </div>
                        </button>

                        {/* Card Solicitar alteração */}
                        <button onClick={() => setDecision("revise")}
                          className="group flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-[hsl(var(--border))] hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-all">
                          <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <MapPin className="h-7 w-7 text-amber-500" />
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-sm text-[hsl(var(--foreground))]">Solicitar alteração</p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60 mt-1">Marcar frames e enviar comentários</p>
                          </div>
                        </button>
                      </div>
                    </div>
                  ) : decision === "approve" ? (
                    /* Confirmação de aprovação */
                    <div className="flex flex-col items-center justify-center py-16 gap-6 px-6 text-center">
                      <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                        <CheckCircle className="h-8 w-8 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[hsl(var(--foreground))] mb-1">Confirmar aprovação?</p>
                        <p className="text-sm text-[hsl(var(--muted-foreground))]">A tarefa será marcada como concluída e o editor será notificado.</p>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => setDecision("idle")} className="px-5 py-2.5 rounded-xl border border-[hsl(var(--border))] text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors">
                          Voltar
                        </button>
                        <button onClick={handleApprove} disabled={approving}
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60 transition-colors">
                          <CheckCircle className="h-4 w-4" />
                          {approving ? "Aprovando…" : "Sim, aprovar"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Modo revisão: player + comentários */
                    <>
                      <div className="bg-black relative">
                        {selected && isVideo(selected) && (
                          <VideoPlayer key={selected.id} src={streamUrl(selected)} reviewMode compact
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick} onCapture={handleCapture} />
                        )}
                        {selected && isAudio(selected) && (
                          <AudioPlayer key={selected.id} src={streamUrl(selected)} fileName={selected.fileName} reviewMode
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick} onCapture={handleCapture} />
                        )}
                        {!selected && (
                          <div className="flex items-center justify-center py-12">
                            <p className="text-sm text-zinc-500">Nenhum arquivo selecionado</p>
                          </div>
                        )}

                        {/* Card de frame capturado */}
                        {capturedFrame && (
                          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}>
                            <div className="bg-[hsl(var(--card))] rounded-2xl overflow-hidden w-80 shadow-2xl border border-[hsl(var(--border))]">
                              {capturedFrame.dataUrl ? <img src={capturedFrame.dataUrl} alt="frame" className="w-full block" /> :
                                <div className="w-full h-20 bg-[hsl(var(--muted))]/40 flex items-center justify-center"><AudioLines className="h-5 w-5 text-[hsl(var(--muted-foreground))]/30" /></div>}
                              <div className="p-3 space-y-2.5">
                                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">⏱ {fmtTime(capturedFrame.time)}</p>
                                <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Escape") setCapturedFrame(null); }}
                                  placeholder="Descreva o que precisa ser alterado…"
                                  className="w-full text-sm resize-none border border-[hsl(var(--border))] rounded-xl p-2.5 bg-[hsl(var(--muted))]/30 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                  rows={3} autoFocus />
                                <div className="flex gap-2">
                                  <button onClick={() => setCapturedFrame(null)} className="flex-1 py-2 rounded-xl border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Cancelar</button>
                                  <button onClick={saveComment} disabled={!commentBody.trim()} className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-40">Salvar</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Lista de comentários pendentes */}
                      <div className="border-b border-amber-200/40 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10 min-h-[56px] max-h-40 overflow-y-auto">
                        {pendingComments.length === 0 ? (
                          <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))]/50 py-4">
                            Pause o vídeo e clique <span className="font-medium text-amber-600 dark:text-amber-400">Marcar</span> para adicionar comentários
                          </p>
                        ) : pendingComments.map((c, i) => (
                          <div key={c.localId} className={`flex items-start gap-2.5 px-4 py-2.5 ${i > 0 ? "border-t border-amber-200/20 dark:border-amber-800/15" : ""}`}>
                            <span className="shrink-0 text-[10px] font-bold text-amber-600 mt-1 w-4 tabular-nums">{i + 1}</span>
                            {c.thumbnailDataUrl && <img src={c.thumbnailDataUrl} className="h-9 w-[64px] rounded object-cover shrink-0 ring-1 ring-amber-400/30" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mb-0.5">{fmtTime(c.timestampSec)}</p>
                              <p className="text-xs text-[hsl(var(--foreground))]/80 leading-snug line-clamp-2">{c.body}</p>
                            </div>
                            <button onClick={() => removeComment(c.localId)} className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))]/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Rodapé: voltar + enviar */}
                      <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-3 bg-[hsl(var(--muted))]/10">
                        <button onClick={() => { setDecision("idle"); setPendingComments([]); setCapturedFrame(null); }}
                          className="text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                          ← Voltar
                        </button>
                        <div className="flex items-center gap-2">
                          {pendingComments.length > 0 && (
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                              {pendingComments.length} comentário{pendingComments.length > 1 ? "s" : ""}
                            </span>
                          )}
                          <button onClick={handleSubmitBatch} disabled={submitting || pendingComments.length === 0}
                            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl disabled:opacity-40 transition-colors">
                            <Send className="h-3.5 w-3.5" />
                            {submitting ? "Enviando…" : "Enviar revisão"}
                          </button>
                        </div>
                      </div>

                      {/* Seletor de arquivo */}
                      {revisionGroups.length > 1 && (
                        <div className="px-4 py-2.5 flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-[hsl(var(--border))]">
                          {revisionGroups.map(([revNum, revFiles], idx) => (
                            <div key={revNum} className="flex items-center gap-1 shrink-0">
                              <button onClick={() => { setActiveRev(revNum); setSelected(revFiles[revFiles.length - 1]); }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${activeRev === revNum ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
                                {revLabel(revNum)}
                              </button>
                              {idx < revisionGroups.length - 1 && <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]/30 shrink-0" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ══════════════════════════════════════════════════
                  TAB 3 — ENVIO AO CLIENTE
                  "Fechar o loop"
              ══════════════════════════════════════════════════ */}
              {activeTab === "envio" && (
                <div className="p-5 space-y-5">

                  {/* Status */}
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isApproved ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/30" : "bg-[hsl(var(--muted))]/30 border-[hsl(var(--border))]"}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${isApproved ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-[hsl(var(--muted))]"}`}>
                      <CheckCircle className={`h-4 w-4 ${isApproved ? "text-emerald-500" : "text-[hsl(var(--muted-foreground))]/30"}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isApproved ? "text-emerald-700 dark:text-emerald-400" : "text-[hsl(var(--muted-foreground))]"}`}>
                        {isApproved ? "Material aprovado" : "Aguardando aprovação"}
                      </p>
                      {isApproved && task.updatedAt && (
                        <p className="text-[11px] text-emerald-600/70 dark:text-emerald-500/60">{fmtDate(task.updatedAt)}</p>
                      )}
                    </div>
                  </div>

                  {/* Compartilhar arquivo */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Compartilhar arquivo com o cliente</p>
                    {approvedFile ? (
                      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 bg-[hsl(var(--muted))]/20">
                          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            {isVideo(approvedFile) ? <Film className="h-4 w-4 text-violet-500" /> : <Music className="h-4 w-4 text-violet-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{approvedFile.fileName}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{fmtSize(approvedFile.fileSize)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-[hsl(var(--border))] border-t border-[hsl(var(--border))]">
                          <a href={downloadUrl(approvedFile)} download={approvedFile.fileName}
                            className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium hover:bg-[hsl(var(--muted))]/50 transition-colors">
                            <Download className="h-3.5 w-3.5" />Baixar arquivo
                          </a>
                          {approvedFile.publicToken ? (
                            <button onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/p/${approvedFile.publicToken}`); toast.success("Link copiado"); }}
                              className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors">
                              <Link2 className="h-3.5 w-3.5" />Copiar link público
                            </button>
                          ) : (
                            <button onClick={() => generateLink(approvedFile.id)} disabled={sharing === approvedFile.id}
                              className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 transition-colors disabled:opacity-50">
                              <Link2 className="h-3.5 w-3.5" />
                              {sharing === approvedFile.id ? "Gerando…" : "Gerar link público"}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-6 rounded-xl border border-dashed border-[hsl(var(--border))] text-center">
                        <p className="text-sm text-[hsl(var(--muted-foreground))]/50">Nenhum arquivo disponível</p>
                      </div>
                    )}
                  </div>

                  {/* Pasta do projeto */}
                  {task.folderUrl && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Pasta do projeto</p>
                      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]">
                        <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]/50" />
                        <span className="flex-1 text-sm text-[hsl(var(--foreground))]/70 break-all leading-snug select-all text-xs">{task.folderUrl}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] transition-colors">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <a href={task.folderUrl} target="_blank" rel="noopener noreferrer"
                            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Brief do cliente */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Briefing</p>
                    <div className="rounded-xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                      {task.client && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Cliente</span>
                          <span className="text-xs font-medium">{task.client}</span>
                        </div>
                      )}
                      {task.dueDate && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Prazo</span>
                          <span className="text-xs font-medium">{fmtDate(task.dueDate)}</span>
                        </div>
                      )}
                      {task.createdBy && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Coordenador</span>
                          <span className="text-xs font-medium">{task.createdBy.name}</span>
                        </div>
                      )}
                      {task.editors?.length > 0 && (
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0">Editor</span>
                          <span className="text-xs font-medium">{task.editors.map(e => e.name).join(", ")}</span>
                        </div>
                      )}
                      {task.description && (
                        <div className="flex items-start gap-3 px-4 py-2.5">
                          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))]/50 w-20 shrink-0 mt-0.5">Nota</span>
                          <span className="text-xs text-[hsl(var(--foreground))]/70 leading-relaxed">{task.description}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
