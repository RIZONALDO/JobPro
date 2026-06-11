import {
  useRef, useState, useEffect, useCallback,
  forwardRef, useImperativeHandle,
  type RefObject,
} from "react";
import { Play, Pause, X, ChevronDown, Volume2, VolumeX } from "lucide-react";
import {
  useScrubBar, useVideoSync,
  type Marker, type TimeFormat, type PlayerHandle,
} from "@/components/player";

export interface VersionFile {
  id: number;
  fileName: string;
  mimeType: string | null;
}

interface Props {
  versionFiles:    VersionFile[];
  streamUrlOf:     (f: VersionFile) => string;
  defaultLeftIdx:  number;
  defaultRightIdx: number;
  markers?:        Marker[];
  onMarkerClick?:  (t: number, annotations?: string | null) => void;
  timeFormat?:     TimeFormat;
  newMarkerTimestamp?: number | null;
  onClose:              () => void;
  onCloseSide:          (keepIdx: number) => void;
  onActiveSideChange?:  (side: "left" | "right", fileId: number) => void;
  onSideVersionChange?: (side: "left" | "right", fileId: number) => void;
}

// ── Header bar de cada lado ───────────────────────────────────────────────────
function VersionPicker({
  files, currentIdx, active, onSelect, onSetActive, onClose,
}: {
  files: VersionFile[];
  currentIdx: number;
  active: boolean;
  onSelect:    (idx: number) => void;
  onSetActive: () => void;
  onClose:     () => void;
}) {
  const [open, setOpen] = useState(false);
  const primary = "hsl(var(--primary))";

  return (
    <div className="shrink-0 relative z-10" onClick={e => e.stopPropagation()}>

      {/* Barra principal — full width, bordas só top e bottom */}
      <div className="flex items-center gap-2 px-3"
        style={{
          height: 40,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(10px)",
          borderBottom: active ? `3px solid ${primary}` : "1px solid rgba(255,255,255,0.10)",
          transition: "border-color 0.15s, border-width 0.1s",
        }}>

        {/* X — sempre à esquerda */}
        <button onClick={onClose}
          className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-white/35 hover:text-white/80 hover:bg-white/10 transition-colors"
          title="Fechar este lado">
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Nome do arquivo — flex-1 */}
        <span className="flex-1 truncate text-[12px] text-white/45 font-medium min-w-0 select-none">
          {files[currentIdx]?.fileName}
        </span>

        {/* Chip versão — único trigger do dropdown */}
        <div className="relative shrink-0">
          <button onClick={() => setOpen(v => !v)}
            className="flex items-center gap-0.5 px-2 py-1 rounded-md hover:bg-white/10 transition-colors"
            style={{ color: active ? primary : "rgba(255,255,255,0.85)" }}>
            <span className="text-[14px] font-bold tracking-tight">v{currentIdx + 1}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>

          {open && (
            <div className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden py-1 z-[100]"
              style={{ background: "rgba(14,15,20,0.97)", backdropFilter: "blur(16px)", boxShadow: "0 8px 32px rgba(0,0,0,0.7)", minWidth: 160, border: "1px solid rgba(255,255,255,0.08)" }}>
              {files.map((f, i) => (
                <button key={f.id} onClick={() => { onSelect(i); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/8 transition-colors"
                  style={{ color: i === currentIdx ? primary : "rgba(255,255,255,0.75)" }}>
                  <span className="text-[13px] font-bold shrink-0">v{i + 1}</span>
                  <span className="truncate text-[11px] opacity-50">{f.fileName}</span>
                  {i === currentIdx && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full shrink-0" style={{ background: primary }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Áudio toggle — sempre à direita */}
        <button onClick={onSetActive}
          className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md hover:bg-white/10 transition-colors"
          title={active ? "Áudio ativo" : "Mudo"}>
          {active
            ? <Volume2 className="h-4 w-4" style={{ color: primary }} />
            : <VolumeX className="h-4 w-4 opacity-30 text-white" />}
        </button>
      </div>

    </div>
  );
}

// ── ComparePlayer ─────────────────────────────────────────────────────────────
export const ComparePlayer = forwardRef<PlayerHandle, Props>(function ComparePlayer({
  versionFiles, streamUrlOf,
  defaultLeftIdx, defaultRightIdx,
  markers = [], onMarkerClick,
  timeFormat = "standard", newMarkerTimestamp,
  onClose, onCloseSide, onActiveSideChange, onSideVersionChange,
}, ref) {
  const leftRef   = useRef<HTMLVideoElement>(null);
  const rightRef  = useRef<HTMLVideoElement>(null);
  const timeRef   = useRef<HTMLSpanElement>(null);
  const durRef    = useRef<HTMLSpanElement>(null);
  const isSyncing    = useRef(false);
  const isLoading    = useRef(false);
  const pendingLoad  = useRef<{ vid: HTMLVideoElement; fn: () => void } | null>(null);
  const leftIdxRef   = useRef(defaultLeftIdx);
  const rightIdxRef  = useRef(defaultRightIdx);
  const activeRef    = useRef<"left" | "right">("right");

  const [playing,  setPlaying]  = useState(false);
  const [active,   setActive]   = useState<"left" | "right">("right");
  const [leftIdx,  setLeftIdx]  = useState(defaultLeftIdx);
  const [rightIdx, setRightIdx] = useState(defaultRightIdx);

  // Expõe PlayerHandle para que o pai possa usar getCurrentTime, pause, etc.
  useImperativeHandle(ref, () => ({
    getCurrentTime: () => leftRef.current?.currentTime ?? 0,
    getTimeFormat:  () => timeFormat,
    getNaturalAr: () => {
      const vid = activeRef.current === "left" ? leftRef.current : rightRef.current;
      return vid && vid.videoHeight > 0 ? vid.videoWidth / vid.videoHeight : 16 / 9;
    },
    pause: () => { leftRef.current?.pause(); rightRef.current?.pause(); },
    seekTo: (t: number) => {
      if (leftRef.current)  leftRef.current.currentTime  = t;
      if (rightRef.current) rightRef.current.currentTime = t;
    },
    capture: () => {
      const vid = activeRef.current === "left" ? leftRef.current : rightRef.current;
      if (!vid) return null;
      try {
        const scale = Math.min(1, 480 / (vid.videoWidth || 480));
        const c = document.createElement("canvas");
        c.width = (vid.videoWidth || 480) * scale;
        c.height = (vid.videoHeight || 270) * scale;
        c.getContext("2d")!.drawImage(vid, 0, 0, c.width, c.height);
        return { time: vid.currentTime, dataUrl: c.toDataURL("image/jpeg", 0.8) };
      } catch { return { time: leftRef.current?.currentTime ?? 0, dataUrl: null }; }
    },
  }), [timeFormat]);

  useEffect(() => {
    if (leftRef.current)  leftRef.current.src  = streamUrlOf(versionFiles[defaultLeftIdx]);
    if (rightRef.current) rightRef.current.src = streamUrlOf(versionFiles[defaultRightIdx]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = useCallback(() => {
    const l = leftRef.current, r = rightRef.current;
    if (!l || !r || isSyncing.current || isLoading.current) return;
    if (Math.abs(r.currentTime - l.currentTime) > 0.08) {
      isSyncing.current = true;
      r.currentTime = l.currentTime;
      isSyncing.current = false;
    }
  }, []);

  useEffect(() => {
    const l = leftRef.current; if (!l) return;
    const onTimeUpdate = () => sync();
    const onPlay   = () => { setPlaying(true);  if (!isLoading.current) rightRef.current?.play().catch(() => {}); };
    const onPause  = () => { setPlaying(false); if (!isLoading.current) rightRef.current?.pause(); };
    const onSeeked = () => sync();
    const onEnded  = () => { setPlaying(false); rightRef.current?.pause(); };
    l.addEventListener("timeupdate",    onTimeUpdate);
    l.addEventListener("play",          onPlay);
    l.addEventListener("pause",         onPause);
    l.addEventListener("seeked",        onSeeked);
    l.addEventListener("ended",         onEnded);
    return () => {
      l.removeEventListener("timeupdate",    onTimeUpdate);
      l.removeEventListener("play",          onPlay);
      l.removeEventListener("pause",         onPause);
      l.removeEventListener("seeked",        onSeeked);
      l.removeEventListener("ended",         onEnded);
    };
  }, [sync]);

  useEffect(() => {
    if (leftRef.current)  leftRef.current.muted  = active !== "left";
    if (rightRef.current) rightRef.current.muted = active !== "right";
  }, [active]);

  // Seek ambos + notifica pai
  const handleMarkerClick = (t: number, annotations?: string | null) => {
    const l = leftRef.current, r = rightRef.current;
    l?.pause(); r?.pause();
    if (l) l.currentTime = t;
    if (r) r.currentTime = t;
    onMarkerClick?.(t, annotations);
  };

  const { ScrubBar, fillRef, bufferRef, thumbRef, isDragging } = useScrubBar({
    mediaRef: leftRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    markers, onMarkerClick: handleMarkerClick, timeFormat, newMarkerTimestamp,
  });

  useVideoSync({
    mediaRef: leftRef as RefObject<HTMLVideoElement | HTMLAudioElement | null>,
    fillRef, bufferRef, thumbRef,
    timeDisplayRef: timeRef, durDisplayRef: durRef,
    isDragging, timeFormat,
  });

  const handleVersionChange = (side: "left" | "right", idx: number) => {
    const l = leftRef.current, r = rightRef.current;
    const vid = side === "left" ? l : r;
    if (!vid || !l) return;
    const savedTime = l.currentTime, wasPlaying = !l.paused;

    if (pendingLoad.current) {
      pendingLoad.current.vid.removeEventListener("canplay", pendingLoad.current.fn);
      pendingLoad.current = null;
    }

    if (side === "left")  { setLeftIdx(idx);  leftIdxRef.current  = idx; }
    else                  { setRightIdx(idx); rightIdxRef.current = idx; }
    onSideVersionChange?.(side, versionFiles[idx]?.id ?? 0);

    isLoading.current = true;
    l.pause(); r?.pause();

    vid.src = streamUrlOf(versionFiles[idx]);

    const onCanPlay = () => {
      vid.currentTime = savedTime;
      const other = side === "left" ? r : l;
      if (other) other.currentTime = savedTime;
      isLoading.current = false;
      pendingLoad.current = null;
      if (wasPlaying) l.play().catch(() => {});
      vid.removeEventListener("canplay", onCanPlay);
    };
    vid.addEventListener("canplay", onCanPlay);
    pendingLoad.current = { vid, fn: onCanPlay };
  };

  const togglePlay = () => {
    const l = leftRef.current; if (!l) return;
    l.paused ? l.play().catch(() => {}) : l.pause();
  };

  const setActiveSide = (side: "left" | "right") => {
    // Alinha os dois vídeos antes de trocar o áudio — evita salto audível
    sync();
    activeRef.current = side;
    setActive(side);
    const idx = side === "left" ? leftIdxRef.current : rightIdxRef.current;
    onActiveSideChange?.(side, versionFiles[idx]?.id ?? 0);
  };

  return (
    <div className="flex flex-col h-full bg-black select-none">

      {/* ── Side-by-side ── */}
      <div className="flex-1 flex min-h-0">

        {/* Left */}
        <div className="flex-1 flex flex-col bg-black cursor-pointer relative"
          onClick={() => setActiveSide("left")}>
          <VersionPicker
            files={versionFiles} currentIdx={leftIdx}
            active={active === "left"}
            onSelect={idx => handleVersionChange("left", idx)}
            onSetActive={() => setActiveSide("left")}
            onClose={() => onCloseSide(rightIdx)}
          />
          <div className="flex-1 relative min-h-0 overflow-hidden">
            <video ref={leftRef} preload="auto" playsInline
              className="absolute inset-0 w-full h-full object-contain"
              style={{ pointerEvents: "none" }} />
          </div>
        </div>

        {/* Right */}
        <div className="flex-1 flex flex-col bg-black cursor-pointer relative"
          onClick={() => setActiveSide("right")}>
          <VersionPicker
            files={versionFiles} currentIdx={rightIdx}
            active={active === "right"}
            onSelect={idx => handleVersionChange("right", idx)}
            onSetActive={() => setActiveSide("right")}
            onClose={() => onCloseSide(leftIdx)}
          />
          <div className="flex-1 relative min-h-0 overflow-hidden">
            <video ref={rightRef} preload="auto" playsInline
              className="absolute inset-0 w-full h-full object-contain"
              style={{ pointerEvents: "none" }} />
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="shrink-0 px-3 pb-2 pt-1" style={{ background: "rgba(0,0,0,0.92)" }}>
        {ScrubBar}
        <div className="flex items-center gap-3 mt-1" style={{ height: 40 }}>
          <button onClick={togglePlay}
            className="shrink-0 text-white/70 hover:text-white transition-colors">
            {playing
              ? <Pause className="h-5 w-5 fill-white text-white" />
              : <Play  className="h-5 w-5 fill-white text-white ml-0.5" />}
          </button>
          <span className="shrink-0 font-mono text-[13px] text-white/40">
            <span ref={timeRef}>0:00.0</span>
            <span className="text-white/20"> / </span>
            <span ref={durRef}>0:00.0</span>
          </span>
          <div className="flex-1" />
          <button onClick={onClose}
            className="shrink-0 text-white/30 hover:text-white/70 transition-colors ml-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
});
