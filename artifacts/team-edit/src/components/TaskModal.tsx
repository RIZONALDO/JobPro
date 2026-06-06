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
  Clock, FolderOpen, RotateCcw, Calendar, AlertTriangle,
  Layers, Copy, ChevronRight, Hash, Tag, Zap,
  Film, Music, Download, Link2, Trash2, FileVideo,
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, MapPin, Send, X, CheckCircle, CheckCircle2,
  Loader2, Clapperboard, AudioLines, Eye,
} from "lucide-react";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SubtaskProgressBar } from "@/components/ui/subtask-progress-bar";
import { MultiTaskBadge } from "@/components/ui/multi-task-badge";
import { ParentTaskBreadcrumb } from "@/components/ui/parent-task-breadcrumb";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "details" | "media" | "history";

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
interface SubtaskSummary {
  id: number; taskCode?: string; title: string; status: string;
  assignedTo: Person | null; editors: Person[]; subtaskOrder: number;
}
interface SubtaskProgress {
  total: number; completed: number; inProgress: number;
  pending: number; cancelled: number; percentage: number;
}
interface TaskDetail {
  id: number; taskCode?: string; title: string; description: string | null;
  client: string | null; color: string; status: string; priority: string;
  complexity: string; dueDate: string | null; startDate?: string | null;
  folderUrl: string | null; revisionCount: number;
  createdBy: Person | null; assignedTo: Person | null; editors: Person[];
  revisions: Revision[]; createdAt: string; updatedAt: string;
  taskType: string; subtasks?: SubtaskSummary[];
  subtaskProgress?: SubtaskProgress;
  parentTask?: { id: number; title: string; taskCode?: string } | null;
}
interface PendingComment {
  localId: string; timestampSec: number; orderIndex: number;
  body: string; thumbnailDataUrl: string | null;
}
interface BatchComment {
  id: number; timestampSec: number; orderIndex: number;
  frameThumbnail: string | null; body: string;
}
interface Marker { timestampSec: number; orderIndex: number; color: "amber" | "sky"; }

interface Props {
  taskId: number; onClose: () => void;
  onOpenTask?: (id: number) => void;
  initialTab?: Tab;
  onDone?: () => void;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

const fmtSize = (b: number | null) => {
  if (!b) return "";
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
};

const fmtTime = (s: number): string => {
  if (!s || !isFinite(s) || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ms}`;
};

const revLabel = (n: number) => (n === 0 ? "Original" : `${n}ª alt.`);

const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const COMPLEXITY_CLS: Record<string, string> = {
  low: "text-slate-400", medium: "text-blue-500", high: "text-purple-500",
};

function isOverdue(dueDate: string | null, status: string) {
  if (!dueDate || ["completed", "cancelled", "paused"].includes(status)) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

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
      const ratio = m.currentTime / m.duration;
      const pct = `${ratio * 100}%`;
      if (fillRef.current) fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;
      if (m.buffered.length > 0 && bufferRef.current)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
      if (timeDisplayRef.current)
        timeDisplayRef.current.textContent = `${fmtTime(m.currentTime)} / ${fmtTime(m.duration)}`;
    };
    const syncBuffer = () => {
      if (!m.duration || !bufferRef.current) return;
      if (m.buffered.length > 0)
        bufferRef.current.style.width = `${(m.buffered.end(m.buffered.length - 1) / m.duration) * 100}%`;
    };
    m.addEventListener("timeupdate", sync);
    m.addEventListener("seeked", sync);
    m.addEventListener("loadedmetadata", sync);
    m.addEventListener("progress", syncBuffer);
    return () => {
      m.removeEventListener("timeupdate", sync);
      m.removeEventListener("seeked", sync);
      m.removeEventListener("loadedmetadata", sync);
      m.removeEventListener("progress", syncBuffer);
    };
  });
}

// ── useScrubBar ───────────────────────────────────────────────────────────────

interface ScrubBarConfig {
  mediaRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  markers: Marker[];
  onMarkerClick: (t: number) => void;
  onScrubStart?: () => void;
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

  const getRatio = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - left) / width));
  };

  const applyVisuals = (ratio: number) => {
    const pct = `${ratio * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
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
    else (m as HTMLMediaElement).currentTime = t;
  };

  const scheduleDragSeek = (ratio: number) => {
    lastSeekRatio.current = ratio;
    if (seekTimer.current !== null) return;
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      const r = lastSeekRatio.current;
      if (r === null || !isDragging.current) return;
      const m = mediaRef.current;
      if (!m?.duration) return;
      const t = r * m.duration;
      if ("fastSeek" in m) (m as HTMLVideoElement).fastSeek(t);
      else (m as HTMLMediaElement).currentTime = t;
    }, 100);
  };

  const showThumb = () => { if (thumbRef.current) { thumbRef.current.style.opacity = "1"; thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)"; } };
  const hideThumb = () => { if (thumbRef.current) thumbRef.current.style.opacity = "0"; };
  const showTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "1"; };
  const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.opacity = "0"; };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    onScrubStart?.();
    showThumb(); showTooltip();
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1.25)";
    const r = getRatio(e.clientX);
    applyVisuals(r); doSeek(r);
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
    const r = getRatio(e.clientX);
    applyVisuals(r); doSeek(r);
    if (thumbRef.current) thumbRef.current.style.transform = "translate(-50%,-50%) scale(1)";
    hideTooltip(); hideThumb();
  };

  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    if (seekTimer.current) clearTimeout(seekTimer.current);
  }, []);

  const ScrubBar = (
    <div className="relative select-none" style={{ padding: "10px 0", cursor: "pointer", touchAction: "none" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerLeave={e => { if (!isDragging.current) { hideThumb(); hideTooltip(); } else onPointerUp(e as any); }}
      onPointerEnter={() => { if (!isDragging.current) { showThumb(); showTooltip(); } }}
    >
      <div ref={trackRef} className="relative rounded-full" style={{ height: 4, background: "rgba(255,255,255,0.2)" }}>
        <div ref={bufferRef} className="absolute inset-y-0 left-0 rounded-full" style={{ width: "0%", background: "rgba(255,255,255,0.35)", transition: "width 1s linear" }} />
        <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-full" style={{ width: "0%", background: "hsl(var(--primary))", transition: "none" }} />
        {markers.map((mk, i) => (
          <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer z-10 group/mk flex items-center justify-center"
            style={{ left: `${(mk.timestampSec / (mediaRef.current?.duration || 1)) * 100}%`, width: 12, height: 20 }}
            onPointerDown={e => { e.stopPropagation(); onMarkerClick(mk.timestampSec); }}>
            <div className={`rounded-sm transition-transform group-hover/mk:scale-150 ${mk.color === "amber" ? "bg-amber-400" : "bg-sky-400"}`} style={{ width: 3, height: 12 }} />
          </div>
        ))}
      </div>
      <div ref={thumbRef} className="absolute rounded-full pointer-events-none"
        style={{ width: 14, height: 14, top: "50%", left: "0%", transform: "translate(-50%,-50%)", background: "white", boxShadow: "0 1px 6px rgba(0,0,0,0.6)", opacity: 0, transition: "opacity 0.15s, transform 0.1s" }} />
      <div ref={tooltipRef} className="absolute pointer-events-none select-none"
        style={{ bottom: "calc(100% + 12px)", left: "0%", transform: "translateX(-50%)", opacity: 0, transition: "opacity 0.12s", background: "rgba(0,0,0,0.88)", color: "#fff", fontSize: 11, fontFamily: "ui-monospace, monospace", padding: "3px 8px", borderRadius: 5, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
        0:00.0
      </div>
    </div>
  );

  return { ScrubBar, fillRef, bufferRef, thumbRef, isDragging };
}

// ── VideoPlayer ───────────────────────────────────────────────────────────────

function VideoPlayer({ src, reviewMode, initialTime, seekTo, markers, onMarkerClick, onCapture }: {
  src: string; reviewMode: boolean; initialTime?: number;
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
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); setWaiting(false); };
    const onPause = () => setPlaying(false);
    const onWait = () => setWaiting(true);
    const onResume = () => setWaiting(false);
    const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
    const onFS = () => setFullscreen(!!document.fullscreenElement);
    v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWait); v.addEventListener("playing", onResume); v.addEventListener("canplay", onResume);
    v.addEventListener("volumechange", onVol);
    document.addEventListener("fullscreenchange", onFS);
    return () => {
      v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWait); v.removeEventListener("playing", onResume); v.removeEventListener("canplay", onResume);
      v.removeEventListener("volumechange", onVol);
      document.removeEventListener("fullscreenchange", onFS);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [src]);

  useEffect(() => {
    if (!initialTime) return;
    const v = videoRef.current;
    if (!v) return;
    const go = () => { v.currentTime = initialTime; };
    v.addEventListener("loadedmetadata", go, { once: true });
    if (v.readyState >= 1) go();
    return () => v.removeEventListener("loadedmetadata", go);
  }, [initialTime, src]);

  useEffect(() => {
    if (!seekTo) return;
    const v = videoRef.current;
    if (v) v.currentTime = seekTo.t;
  }, [seekTo]);

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

  const controlsVisible = showControls || !playing;

  return (
    <div ref={containerRef} className="relative w-full bg-black select-none overflow-hidden"
      style={{ cursor: controlsVisible ? "default" : "none" }}
      onMouseMove={resetHide} onMouseLeave={() => { if (playing) setShowControls(false); }}>
      <video ref={videoRef} src={src} preload="auto" playsInline className="w-full block"
        style={fullscreen ? { width: "100%", height: "100vh", objectFit: "contain" } : { maxHeight: "45vh", minHeight: 200 }}
        onClick={togglePlay} />
      {waiting && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="h-9 w-9 text-white/70 animate-spin" /></div>}
      {!playing && !waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <Play className="h-6 w-6 text-white fill-white ml-1" />
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? "auto" : "none", transition: "opacity 0.25s" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 70%, transparent 100%)" }} />
        <div className="relative px-4 pb-3" style={{ paddingTop: 28 }}>
          {ScrubBar}
          <div className="flex items-center gap-2.5 mt-0.5">
            <button onClick={togglePlay} className="text-white hover:text-white/80 shrink-0 transition-colors">
              {playing ? <Pause className="h-[18px] w-[18px] fill-white" /> : <Play className="h-[18px] w-[18px] fill-white ml-0.5" />}
            </button>
            <button onClick={() => skip(-10)} className="text-white/55 hover:text-white shrink-0 transition-colors"><SkipBack className="h-4 w-4" /></button>
            <button onClick={() => skip(10)} className="text-white/55 hover:text-white shrink-0 transition-colors"><SkipForward className="h-4 w-4" /></button>
            <span ref={timeRef} className="shrink-0 tabular-nums" style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>0:00.0 / 0:00.0</span>
            <div className="flex-1" />
            {reviewMode && (
              <>
                <button onClick={() => stepFrame(-1)} title="Frame anterior" className="shrink-0 flex items-center justify-center rounded transition-colors text-amber-300/80 hover:text-amber-100" style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.3)", fontSize: 11, fontFamily: "monospace" }}>◀|</button>
                <button onClick={() => stepFrame(1)} title="Próximo frame" className="shrink-0 flex items-center justify-center rounded transition-colors text-amber-300/80 hover:text-amber-100" style={{ width: 28, height: 28, border: "1px solid rgba(251,191,36,0.3)", fontSize: 11, fontFamily: "monospace" }}>|▶</button>
                <button onClick={captureFrame} className="shrink-0 flex items-center gap-1.5 rounded-lg text-white font-semibold transition-colors" style={{ padding: "4px 10px", background: "#f59e0b", fontSize: 11 }}
                  onMouseOver={e => (e.currentTarget.style.background = "#d97706")} onMouseOut={e => (e.currentTarget.style.background = "#f59e0b")}>
                  <MapPin className="h-3 w-3" />Marcar frame
                </button>
              </>
            )}
            <button onClick={toggleMute} className="text-white/55 hover:text-white shrink-0 transition-colors">
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={e => setVol(+e.target.value)}
              className="shrink-0 cursor-pointer rounded-full" style={{ width: 60, height: 4, accentColor: "hsl(var(--primary))" }} />
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
    <div className="flex flex-col items-center gap-5 py-8 px-8 w-full max-w-xs mx-auto">
      <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.12)", border: "1px solid hsl(var(--primary) / 0.2)" }}>
        <AudioLines className={`h-7 w-7 text-[hsl(var(--primary))] ${playing ? "animate-pulse" : ""}`} />
        {playing && <div className="absolute inset-0 rounded-2xl ring-2 ring-[hsl(var(--primary))]/25 animate-ping" />}
      </div>
      <p className="text-xs font-medium text-zinc-300 text-center truncate w-full">{fileName}</p>
      <div className="w-full">
        {ScrubBar}
        <span ref={timeRef} className="block text-right mt-1 tabular-nums" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "ui-monospace, monospace" }}>0:00.0 / 0:00.0</span>
      </div>
      <div className="flex items-center gap-7">
        <button onClick={() => skip(-10)} className="flex flex-col items-center gap-0.5 transition-colors text-zinc-500 hover:text-zinc-200"><SkipBack className="h-4 w-4" /><span style={{ fontSize: 9 }}>-10s</span></button>
        <button onClick={togglePlay} className="h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-all" style={{ background: "hsl(var(--primary))" }}
          onMouseOver={e => (e.currentTarget.style.filter = "brightness(0.9)")} onMouseOut={e => (e.currentTarget.style.filter = "")}>
          {playing ? <Pause className="h-4 w-4 text-white fill-white" /> : <Play className="h-4 w-4 text-white fill-white ml-0.5" />}
        </button>
        <button onClick={() => skip(10)} className="flex flex-col items-center gap-0.5 transition-colors text-zinc-500 hover:text-zinc-200"><SkipForward className="h-4 w-4" /><span style={{ fontSize: 9 }}>+10s</span></button>
      </div>
      {reviewMode && (
        <button onClick={() => { const a = audioRef.current; if (a) { a.pause(); onCapture(a.currentTime, null); } }}
          className="flex items-center gap-2 w-full justify-center text-white font-semibold rounded-xl transition-colors" style={{ padding: "8px 16px", background: "#f59e0b", fontSize: 12 }}>
          <MapPin className="h-3.5 w-3.5" />Marcar ponto
        </button>
      )}
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => { const a = audioRef.current; if (a) a.muted = !a.muted; }} className="text-zinc-500 hover:text-zinc-200 transition-colors shrink-0">
          {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={e => { const v = +e.target.value, a = audioRef.current; if (a) { a.volume = v; a.muted = v === 0; } }}
          className="flex-1 cursor-pointer rounded-full" style={{ height: 4, accentColor: "hsl(var(--primary))" }} />
      </div>
      <audio ref={audioRef} src={src} preload="auto" />
    </div>
  );
}

// ── TaskModal ─────────────────────────────────────────────────────────────────

export function TaskModal({ taskId, onClose, onOpenTask, initialTab = "details", onDone }: Props) {
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [sharing, setSharing] = useState<number | null>(null);

  // Tab
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  // Para navegar Histórico → Mídia com seek
  const [mediaSeekInit, setMediaSeekInit] = useState<{ fileId: number | null; time: number; key: number } | null>(null);

  // Player state (aba Mídia)
  const [selected, setSelected] = useState<TaskFile | null>(null);
  const [activeRev, setActiveRev] = useState<number>(0);
  const [reviewMode, setReviewMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [capturedFrame, setCapturedFrame] = useState<{ time: number; dataUrl: string | null } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [seekTarget, setSeekTarget] = useState<{ t: number; n: number } | null>(null);

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin" || user?.role === "supervisor";

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<TaskDetail>(`/api/tasks/${taskId}`),
      apiFetch<TaskFile[]>(`/api/tasks/${taskId}/files`).catch(() => [] as TaskFile[]),
      apiFetch<ReviewBatch[]>(`/api/tasks/${taskId}/review-batches`).catch(() => [] as ReviewBatch[]),
    ]).then(([t, f, b]) => {
      setTask(t); setFiles(f); setBatches(b);
      if (!selected && f.length > 0) {
        const last = f[f.length - 1];
        setSelected(last); setActiveRev(last.revisionNumber);
      }
    }).catch(() => toast.error("Erro ao carregar tarefa"))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // Quando mediaSeekInit muda, aplica seek e troca tab
  useEffect(() => {
    if (!mediaSeekInit) return;
    const f = files.find(x => x.id === mediaSeekInit.fileId);
    if (f) { setSelected(f); setActiveRev(f.revisionNumber); }
    setSeekTarget({ t: mediaSeekInit.time, n: mediaSeekInit.key });
  }, [mediaSeekInit]);

  // Utils arquivos
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

  const activeFiles = useMemo(
    () => revisionGroups.find(([n]) => n === activeRev)?.[1] ?? [],
    [revisionGroups, activeRev]
  );

  // Batchcomments do último batch (para aba in_revision)
  const lastBatchComments: BatchComment[] = useMemo(() => {
    if (!task || task.status !== "in_revision" || batches.length === 0) return [];
    return batches[batches.length - 1].comments;
  }, [task, batches]);

  const allMarkers: Marker[] = useMemo(() => [
    ...pendingComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "amber" as const })),
    ...lastBatchComments.map(c => ({ timestampSec: c.timestampSec, orderIndex: c.orderIndex, color: "sky" as const })),
  ], [pendingComments, lastBatchComments]);

  // Ações arquivos
  const generateLink = async (fileId: number) => {
    setSharing(fileId);
    try {
      const { token } = await apiPost<{ token: string }>(`/api/tasks/${taskId}/files/${fileId}/share`, {});
      const url = `${window.location.origin}/p/${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: token } : f));
    } catch { toast.error("Erro ao gerar link"); }
    finally { setSharing(null); }
  };

  const revokeLink = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}/share`);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, publicToken: null } : f));
      toast.success("Link revogado");
    } catch { toast.error("Erro ao revogar link"); }
  };

  const removeFile = async (fileId: number) => {
    try {
      await apiDelete(`/api/tasks/${taskId}/files/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success("Arquivo removido");
    } catch { toast.error("Erro ao remover arquivo"); }
  };

  // Ações revisão
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
      toast.success("Tarefa aprovada"); onDone?.(); onClose();
    } catch { toast.error("Erro ao aprovar"); }
    finally { setApproving(false); setConfirmApprove(false); }
  };

  const canAct = isCoordinator && task?.status === "review";
  const hasMedia = files.some(f => isVideo(f) || isAudio(f));
  const overdue = task ? isOverdue(task.dueDate, task.status) : false;

  // ── Tab bar ────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "details", label: "Detalhes" },
    ...(hasMedia || files.length > 0 ? [{ id: "media" as Tab, label: "Mídia", badge: files.length }] : []),
    { id: "history", label: "Histórico", badge: (task?.revisions.length ?? 0) + batches.length || undefined },
  ];

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

            {/* ── HEADER ── */}
            <div className="shrink-0 px-6 pt-5 pb-0 border-b border-[hsl(var(--border))]">
              {task.taskType === "subtask" && task.parentTask && (
                <div className="mb-2"><ParentTaskBreadcrumb parentTask={task.parentTask} onClickParent={onOpenTask} /></div>
              )}
              <h2 className="text-[18px] font-bold leading-snug tracking-tight text-[hsl(var(--foreground))] mb-2 flex items-baseline gap-2 flex-wrap">
                {task.taskCode && <><span className="font-mono text-[hsl(var(--muted-foreground))]/50 shrink-0">{task.taskCode}</span><span className="text-[hsl(var(--muted-foreground))]/30 shrink-0">|</span></>}
                <span>{task.title}</span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none ${STATUS_CHIP[task.status] ?? "bg-slate-500/10 text-slate-500"}`}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
                <MultiTaskBadge taskType={task.taskType} />
                {task.revisionCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40">
                    <RotateCcw className="h-3 w-3" />{task.revisionCount} alt.
                  </span>
                )}
                {task.client && <><span className="text-[hsl(var(--border))]">·</span><span className="text-[11px] text-[hsl(var(--muted-foreground))]/60 flex items-center gap-1"><Tag className="h-3 w-3 opacity-40" />{task.client}</span></>}
              </div>

              {/* Tab bar */}
              <div className="flex gap-0 -mb-px">
                {tabs.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    }`}>
                    {tab.label}
                    {tab.badge ? (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === tab.id ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}>
                        {tab.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {/* ── CONTEÚDO ── */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ══ DETALHES ══ */}
              {activeTab === "details" && (
                <>
                  {/* Grid propriedades */}
                  <div className="grid grid-cols-2 divide-x divide-y divide-[hsl(var(--border))] border-b border-[hsl(var(--border))]">
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5 flex items-center gap-1"><Clock className="h-3 w-3" />Entrega</p>
                      {task.dueDate ? (
                        <div className={`flex items-center gap-1.5 ${overdue ? "text-red-500" : "text-[hsl(var(--foreground))]"}`}>
                          {overdue ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Calendar className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]/60" />}
                          <span className="text-sm font-semibold">{fmtDate(task.dueDate)}</span>
                        </div>
                      ) : <span className="text-sm text-[hsl(var(--muted-foreground))]/30">—</span>}
                      {overdue && <p className="text-[10px] font-bold text-red-500 mt-0.5">Atrasada</p>}
                    </div>
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Prioridade</p>
                      <PriorityBadge priority={task.priority} showLabel className="text-sm" />
                    </div>
                    <div className="px-5 py-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Complexidade</p>
                      <div className={`flex items-center gap-1.5 ${COMPLEXITY_CLS[task.complexity] ?? ""}`}>
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-sm font-semibold">{COMPLEXITY_LABEL[task.complexity] ?? task.complexity}</span>
                      </div>
                    </div>
                    <div className="px-5 py-3.5">
                      {task.taskType === "multi_task" && task.subtaskProgress ? (
                        <><p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Progresso</p>
                        <SubtaskProgressBar total={task.subtaskProgress.total} completed={task.subtaskProgress.completed} percentage={task.subtaskProgress.percentage} /></>
                      ) : (
                        <><p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-1.5">Atualizado</p>
                        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{fmtDate(task.updatedAt)}</span></>
                      )}
                    </div>
                  </div>

                  {/* Equipe */}
                  <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Equipe</p>
                    {(task.createdBy || task.editors?.length > 0) ? (
                      <div className="flex flex-wrap gap-2">
                        {task.createdBy && (
                          <div className="flex items-center gap-2 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl px-3 py-2">
                            <AvatarDisplay name={task.createdBy.name} avatarUrl={task.createdBy.avatarUrl ?? null} size={26} />
                            <div><p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Coordenador</p><p className="text-xs font-semibold leading-none">{task.createdBy.name.split(" ").slice(0, 2).join(" ")}</p></div>
                          </div>
                        )}
                        {task.editors?.map(e => (
                          <div key={e.id} className="flex items-center gap-2 bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))] rounded-xl px-3 py-2">
                            <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl ?? null} size={26} />
                            <div><p className="text-[9px] text-[hsl(var(--muted-foreground))]/50 leading-none mb-0.5">Editor</p><p className="text-xs font-semibold leading-none">{e.name.split(" ").slice(0, 2).join(" ")}</p></div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem equipe atribuída.</p>}
                  </div>

                  {/* Descrição */}
                  <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Direcionamento</p>
                    {task.description
                      ? <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                      : <p className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Sem descrição.</p>}
                  </div>

                  {/* Subtarefas */}
                  {task.taskType === "multi_task" && task.subtasks && task.subtasks.length > 0 && (
                    <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-3">Subtarefas · {task.subtasks.length}</p>
                      <div className="space-y-1">
                        {task.subtasks.map(sub => (
                          <button key={sub.id} type="button" onClick={() => onOpenTask?.(sub.id)}
                            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/50 hover:border-[hsl(var(--primary))]/30 transition-all group">
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: sub.status === "completed" ? "#22c55e" : sub.status === "in_progress" ? "#3b82f6" : sub.status === "cancelled" ? "#ef4444" : "#a1a1aa" }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))] transition-colors">{sub.title}</p>
                              <p className="text-[10px] text-[hsl(var(--muted-foreground))]/50 mt-0.5">{STATUS_LABEL[sub.status] ?? sub.status}{sub.assignedTo && ` · ${sub.assignedTo.name.split(" ")[0]}`}</p>
                            </div>
                            {sub.assignedTo && <AvatarDisplay name={sub.assignedTo.name} avatarUrl={sub.assignedTo.avatarUrl} style={{ width: 22, height: 22, fontSize: 8, flexShrink: 0 }} />}
                            <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/25 group-hover:text-[hsl(var(--primary))] shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pasta */}
                  <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mb-2">Pasta / Arquivos</p>
                    {task.folderUrl ? (
                      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/40 border border-[hsl(var(--border))]">
                        <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--muted-foreground))]/50" />
                        <span className="flex-1 text-sm text-[hsl(var(--foreground))]/70 break-all leading-snug select-all">{task.folderUrl}</span>
                        <button type="button" title="Copiar" onClick={() => { navigator.clipboard.writeText(task.folderUrl!); toast.success("Copiado!"); }}
                          className="shrink-0 p-1 rounded-lg text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/20 border border-dashed border-[hsl(var(--border))]">
                        <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]/25" />
                        <span className="text-sm text-[hsl(var(--muted-foreground))]/30 italic">Nenhuma pasta vinculada.</span>
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-3 text-[10px] text-[hsl(var(--muted-foreground))]/30">Criado em {fmtDate(task.createdAt)}</div>
                </>
              )}

              {/* ══ MÍDIA ══ */}
              {activeTab === "media" && (
                <div className="flex flex-col">
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-2">
                      <Clapperboard className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" />
                      <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhum arquivo enviado</p>
                    </div>
                  ) : (
                    <>
                      {/* Player */}
                      <div className="bg-black flex items-center justify-center relative">
                        {selected && isVideo(selected) && (
                          <VideoPlayer key={selected.id} src={streamUrl(selected)} reviewMode={reviewMode}
                            initialTime={mediaSeekInit?.fileId === selected.id ? mediaSeekInit.time : undefined}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick} onCapture={handleCapture} />
                        )}
                        {selected && isAudio(selected) && (
                          <AudioPlayer key={selected.id} src={streamUrl(selected)} fileName={selected.fileName} reviewMode={reviewMode}
                            seekTo={seekTarget} markers={allMarkers} onMarkerClick={handleMarkerClick} onCapture={handleCapture} />
                        )}

                        {/* Card de comentário de frame */}
                        {capturedFrame && (
                          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}>
                            <div className="bg-[hsl(var(--card))] rounded-2xl overflow-hidden w-80 shadow-2xl border border-[hsl(var(--border))]">
                              {capturedFrame.dataUrl
                                ? <img src={capturedFrame.dataUrl} alt="frame" className="w-full block" />
                                : <div className="w-full h-20 bg-[hsl(var(--muted))]/40 flex items-center justify-center"><AudioLines className="h-6 w-6 text-[hsl(var(--muted-foreground))]/30" /></div>
                              }
                              <div className="p-3 space-y-2.5">
                                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">⏱ {fmtTime(capturedFrame.time)}</p>
                                <textarea value={commentBody} onChange={e => setCommentBody(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Escape") setCapturedFrame(null); }}
                                  placeholder="Descreva o que precisa ser alterado…"
                                  className="w-full text-sm resize-none border border-[hsl(var(--border))] rounded-xl p-2.5 bg-[hsl(var(--muted))]/30 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                  rows={3} autoFocus />
                                <div className="flex gap-2">
                                  <button onClick={() => setCapturedFrame(null)} className="flex-1 py-2 rounded-xl border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Cancelar</button>
                                  <button onClick={saveComment} disabled={!commentBody.trim()} className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-40">Salvar comentário</button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Controles de revisão — header da seção */}
                      {canAct && hasMedia && (
                        <div className="px-4 py-2.5 border-b border-[hsl(var(--border))] flex items-center gap-2 bg-[hsl(var(--muted))]/20">
                          <button onClick={() => { setReviewMode(v => !v); setPendingComments([]); setCapturedFrame(null); setConfirmApprove(false); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${reviewMode ? "bg-amber-500 text-white" : "border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-amber-400 hover:text-amber-600"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${reviewMode ? "bg-white animate-pulse" : "bg-current opacity-40"}`} />
                            {reviewMode ? "Revisando" : "Revisar"}
                          </button>
                          {!reviewMode && (confirmApprove ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[hsl(var(--muted-foreground))]">Confirmar?</span>
                              <button onClick={handleApprove} disabled={approving} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-60">
                                <CheckCircle className="h-3.5 w-3.5" />{approving ? "Aprovando…" : "Sim"}
                              </button>
                              <button onClick={() => setConfirmApprove(false)} className="px-2 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]">Não</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmApprove(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
                              <CheckCircle className="h-3.5 w-3.5" />Aprovar
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Comentários do último batch (in_revision — editor lê) */}
                      {!reviewMode && lastBatchComments.length > 0 && (
                        <div className="border-b border-sky-200/40 dark:border-sky-800/30 bg-sky-50/30 dark:bg-sky-950/10 max-h-44 overflow-y-auto">
                          <div className="px-4 pt-2.5 pb-1 flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                            <p className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 uppercase tracking-wide">
                              {lastBatchComments.length} alteração{lastBatchComments.length > 1 ? "ões" : ""} solicitada{lastBatchComments.length > 1 ? "s" : ""}
                            </p>
                          </div>
                          {lastBatchComments.map(c => (
                            <div key={c.id} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-sky-200/20 dark:border-sky-800/15">
                              <span className="shrink-0 text-[10px] font-bold text-sky-500 mt-1 w-4 tabular-nums">{c.orderIndex}</span>
                              {c.frameThumbnail
                                ? <button onClick={() => handleMarkerClick(c.timestampSec)} className="shrink-0 group"><img src={c.frameThumbnail} className="h-10 w-[72px] rounded-md object-cover ring-1 ring-sky-400/30 group-hover:ring-sky-400 transition-all" /></button>
                                : <button onClick={() => handleMarkerClick(c.timestampSec)} className="shrink-0 h-10 w-[72px] rounded-md bg-sky-100 dark:bg-sky-950/30 border border-sky-300/40 flex items-center justify-center text-[9px] font-mono text-sky-600 hover:bg-sky-200/60">{fmtTime(c.timestampSec)}</button>
                              }
                              <p className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))]/80 leading-snug pt-0.5">{c.body}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Comentários pendentes (reviewMode) */}
                      {reviewMode && (
                        <div className="border-b border-amber-200/40 dark:border-amber-800/30 bg-amber-50/30 dark:bg-amber-950/10 max-h-40 overflow-y-auto">
                          {pendingComments.length === 0 ? (
                            <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))]/50 py-4 px-4">
                              Pause o vídeo e clique em <span className="font-medium text-amber-600 dark:text-amber-400">Marcar frame</span>
                            </p>
                          ) : pendingComments.map((c, i) => (
                            <div key={c.localId} className="flex items-start gap-2.5 px-4 py-2.5 border-t border-amber-200/20 dark:border-amber-800/15 first:border-t-0">
                              <span className="shrink-0 text-[10px] font-bold text-amber-600 mt-1 w-4 tabular-nums">{i + 1}</span>
                              {c.thumbnailDataUrl && <button onClick={() => handleMarkerClick(c.timestampSec)} className="shrink-0 group"><img src={c.thumbnailDataUrl} className="h-10 w-[72px] rounded-md object-cover ring-1 ring-amber-400/30 group-hover:ring-amber-400 transition-all" /></button>}
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mb-0.5">{fmtTime(c.timestampSec)}</p>
                                <p className="text-xs text-[hsl(var(--foreground))]/80 leading-snug line-clamp-2">{c.body}</p>
                              </div>
                              <button onClick={() => removeComment(c.localId)} className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))]/30 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Barra enviar revisão */}
                      {reviewMode && pendingComments.length > 0 && (
                        <div className="px-4 py-2.5 border-b border-amber-300/40 flex items-center justify-between bg-amber-50/60 dark:bg-amber-950/20">
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{pendingComments.length} comentário{pendingComments.length > 1 ? "s" : ""} prontos</span>
                          <button onClick={handleSubmitBatch} disabled={submitting} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg disabled:opacity-60">
                            <Send className="h-3.5 w-3.5" />{submitting ? "Enviando…" : "Enviar revisão"}
                          </button>
                        </div>
                      )}

                      {/* Info bar + download */}
                      {selected && (
                        <div className="px-4 py-2 border-b border-[hsl(var(--border))] flex items-center gap-3 bg-[hsl(var(--muted))]/20">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-[hsl(var(--foreground))] truncate">{selected.fileName}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                              {[selected.uploaderName?.split(" ")[0], fmtDate(selected.createdAt), fmtSize(selected.fileSize)].filter(Boolean).join(" · ")}
                              {selected.approvedAt && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 font-medium">· ✓ Aprovado</span>}
                            </p>
                          </div>
                          <a href={downloadUrl(selected)} download={selected.fileName} className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
                            <Download className="h-3.5 w-3.5" />Baixar
                          </a>
                        </div>
                      )}

                      {/* Seletor de versão */}
                      <div className="border-b border-[hsl(var(--border))]">
                        <div className="flex items-center gap-1 px-4 pt-3 pb-2 overflow-x-auto scrollbar-none">
                          {revisionGroups.map(([revNum, revFiles], idx) => {
                            const isActive = activeRev === revNum;
                            const isApproved = revFiles.some(f => f.approvedAt);
                            return (
                              <div key={revNum} className="flex items-center gap-1 shrink-0">
                                <button onClick={() => { setActiveRev(revNum); setSelected(revFiles[revFiles.length - 1]); }}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}>
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
                            <button key={f.id} onClick={() => { setSelected(f); setActiveRev(f.revisionNumber); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${f.id === selected?.id ? "bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20" : "hover:bg-[hsl(var(--muted))]/50 border border-transparent"}`}>
                              {isVideo(f) ? <Clapperboard className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />
                                : <AudioLines className={`h-3.5 w-3.5 shrink-0 ${f.id === selected?.id ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))]"}`} />}
                              <span className={`text-[11px] font-medium truncate flex-1 ${f.id === selected?.id ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>{f.fileName}</span>
                              {f.approvedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ══ HISTÓRICO ══ */}
              {activeTab === "history" && (() => {
                if (task.revisions.length === 0 && files.length === 0 && batches.length === 0)
                  return <div className="flex flex-col items-center justify-center py-20 gap-2"><Zap className="h-8 w-8 text-[hsl(var(--muted-foreground))]/20" /><p className="text-sm text-[hsl(var(--muted-foreground))]">Sem histórico ainda</p></div>;

                const filesByRev = new Map<number, TaskFile[]>();
                files.forEach(f => { if (!filesByRev.has(f.revisionNumber)) filesByRev.set(f.revisionNumber, []); filesByRev.get(f.revisionNumber)!.push(f); });

                type TEntry = { kind: "delivery"; revNum: number; fs: TaskFile[] } | { kind: "request"; rev: Revision };
                const timeline: TEntry[] = [];
                if (filesByRev.has(0)) timeline.push({ kind: "delivery", revNum: 0, fs: filesByRev.get(0)! });
                task.revisions.forEach(r => {
                  timeline.push({ kind: "request", rev: r });
                  if (filesByRev.has(r.revisionNumber)) timeline.push({ kind: "delivery", revNum: r.revisionNumber, fs: filesByRev.get(r.revisionNumber)! });
                });
                const covered = new Set([0, ...task.revisions.map(r => r.revisionNumber)]);
                filesByRev.forEach((fs, n) => { if (!covered.has(n)) timeline.push({ kind: "delivery", revNum: n, fs }); });

                const FileCard = ({ f }: { f: TaskFile }) => (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[hsl(var(--muted))]/30 border border-[hsl(var(--border))]">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      {isVideo(f) ? <Film className="h-4 w-4 text-violet-500" /> : <Music className="h-4 w-4 text-violet-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{f.fileName}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{[fmtSize(f.fileSize), f.uploaderName?.split(" ")[0], fmtDate(f.createdAt)].filter(Boolean).join(" · ")}</span>
                        {f.approvedAt && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />Aprovado</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(isVideo(f) || isAudio(f)) && (
                        <button title="Ver no player" onClick={() => { setMediaSeekInit({ fileId: f.id, time: 0, key: Date.now() }); setActiveTab("media"); }}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-violet-500 hover:bg-violet-500/10 transition-colors">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <a href={downloadUrl(f)} download={f.fileName} title="Baixar" className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"><Download className="h-3.5 w-3.5" /></a>
                      {f.publicToken ? (
                        <button title="Link ativo — copiar" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/p/${f.publicToken}`); toast.success("Link copiado"); }}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"><Link2 className="h-3.5 w-3.5" /></button>
                      ) : (
                        <button title="Gerar link público" onClick={() => generateLink(f.id)} disabled={sharing === f.id}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors disabled:opacity-40"><Link2 className="h-3.5 w-3.5" /></button>
                      )}
                      <button title="Remover" onClick={() => removeFile(f.id)} className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );

                return (
                  <div className="px-5 py-4">
                    <div className="space-y-0">
                      {timeline.map((entry, i) => {
                        const isLast = i === timeline.length - 1;
                        if (entry.kind === "delivery") {
                          const label = entry.revNum === 0 ? "Entrega original" : `Entrega após ${entry.revNum}ª alteração`;
                          return (
                            <div key={`d-${entry.revNum}`} className="flex gap-3">
                              <div className="flex flex-col items-center shrink-0 pt-0.5">
                                <div className="h-6 w-6 rounded-full bg-violet-500/15 border border-violet-400/40 flex items-center justify-center shrink-0"><FileVideo className="h-3 w-3 text-violet-500" /></div>
                                {!isLast && <div className="w-px flex-1 mt-1 mb-1 bg-[hsl(var(--border))]" />}
                              </div>
                              <div className={`flex-1 min-w-0 ${!isLast ? "pb-4" : ""}`}>
                                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 mb-2">{label}</p>
                                <div className="space-y-2">{entry.fs.map(f => <FileCard key={f.id} f={f} />)}</div>
                              </div>
                            </div>
                          );
                        } else {
                          const batch = batches.find(b => b.revisionNumber === entry.rev.revisionNumber);
                          return (
                            <div key={`r-${entry.rev.id}`} className="flex gap-3">
                              <div className="flex flex-col items-center shrink-0 pt-0.5">
                                <div className="h-6 w-6 rounded-full bg-amber-100 dark:bg-amber-950/50 border border-amber-300/70 dark:border-amber-700/60 flex items-center justify-center text-[10px] font-bold text-amber-600 shrink-0">{entry.rev.revisionNumber}</div>
                                {!isLast && <div className="w-px flex-1 mt-1 mb-1 bg-[hsl(var(--border))]" />}
                              </div>
                              <div className={`flex-1 min-w-0 ${!isLast ? "pb-4" : ""}`}>
                                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mb-1">
                                  {entry.rev.revisionNumber}ª alteração solicitada
                                  <span className="font-normal text-[hsl(var(--muted-foreground))]/40 ml-1">{fmtDate(entry.rev.createdAt)}</span>
                                </p>
                                {batch && batch.comments.length > 0 ? (
                                  <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/30 overflow-hidden">
                                    {batch.comments.map((fc, ci) => (
                                      <div key={fc.id} className={`flex items-start gap-2.5 px-3 py-2 bg-amber-50/50 dark:bg-amber-950/10 ${ci < batch.comments.length - 1 ? "border-b border-amber-200/40 dark:border-amber-800/20" : ""}`}>
                                        <span className="shrink-0 text-[10px] font-bold text-amber-500 mt-1 w-4 tabular-nums">{fc.orderIndex}</span>
                                        {fc.frameThumbnail ? (
                                          <button onClick={() => { setMediaSeekInit({ fileId: batch.taskFileId, time: fc.timestampSec, key: Date.now() }); setActiveTab("media"); }} className="shrink-0 relative group">
                                            <img src={fc.frameThumbnail} className="h-10 w-[72px] rounded-md object-cover ring-1 ring-amber-400/30 group-hover:ring-amber-400 transition-all" />
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-md"><Eye className="h-3.5 w-3.5 text-white" /></div>
                                          </button>
                                        ) : (
                                          <button onClick={() => { setMediaSeekInit({ fileId: batch.taskFileId, time: fc.timestampSec, key: Date.now() }); setActiveTab("media"); }}
                                            className="shrink-0 h-10 w-[72px] rounded-md bg-amber-100 dark:bg-amber-950/30 border border-amber-300/40 flex items-center justify-center text-[9px] font-mono text-amber-600 hover:bg-amber-200/60">
                                            {fmtTime(fc.timestampSec)}
                                          </button>
                                        )}
                                        <p className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))]/80 leading-snug pt-0.5">{fc.body}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="px-3 py-2 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30">
                                    <p className="text-sm text-[hsl(var(--foreground))]/80 leading-relaxed">{entry.rev.comment}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
