// ─── Sound Presets ────────────────────────────────────────────────────────────
// Todos os sons são sintetizados via Web Audio API — sem arquivos externos.

export type SoundPreset = "ping" | "chime" | "pop" | "ding" | "boop" | "none";

export interface SoundOption {
  value: SoundPreset;
  label: string;
  description: string;
}

export const SOUND_OPTIONS: SoundOption[] = [
  { value: "ping",  label: "Ping",   description: "Dois tons agudos rápidos" },
  { value: "chime", label: "Chime",  description: "Sino suave descendente" },
  { value: "pop",   label: "Pop",    description: "Estalo curto e leve" },
  { value: "ding",  label: "Ding",   description: "Nota única e clara" },
  { value: "boop",  label: "Boop",   description: "Três pulsos ascendentes" },
  { value: "none",  label: "Silêncio", description: "Sem som" },
];

async function ctx(): Promise<AudioContext | null> {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new AudioCtx();
    if (c.state === "suspended") await c.resume();
    return c;
  } catch { return null; }
}

type Tone = { freq: number; delay: number; dur: number; vol?: number; type?: OscillatorType };

function schedule(c: AudioContext, tones: Tone[], onEnd?: () => void) {
  tones.forEach((t, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = t.type ?? "sine";
    osc.frequency.value = t.freq;
    const v = t.vol ?? 0.25;
    gain.gain.setValueAtTime(0, c.currentTime + t.delay);
    gain.gain.linearRampToValueAtTime(v, c.currentTime + t.delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t.delay + t.dur);
    osc.start(c.currentTime + t.delay);
    osc.stop(c.currentTime + t.delay + t.dur);
    if (i === tones.length - 1) osc.onended = () => { onEnd?.(); c.close(); };
  });
}

const PRESETS: Record<SoundPreset, (c: AudioContext) => void> = {
  // Dois pings agudos descendentes (som atual de notificação)
  ping: c => schedule(c, [
    { freq: 880, delay: 0,    dur: 0.32 },
    { freq: 660, delay: 0.15, dur: 0.32 },
  ]),

  // Sino suave — três notas descendentes longas
  chime: c => schedule(c, [
    { freq: 1047, delay: 0,    dur: 0.5, vol: 0.18 },
    { freq: 880,  delay: 0.18, dur: 0.5, vol: 0.14 },
    { freq: 698,  delay: 0.36, dur: 0.5, vol: 0.10 },
  ]),

  // Pop curto — triângulo rápido
  pop: c => schedule(c, [
    { freq: 600, delay: 0, dur: 0.08, vol: 0.3, type: "triangle" },
    { freq: 400, delay: 0.05, dur: 0.07, vol: 0.15, type: "triangle" },
  ]),

  // Ding — nota única limpa
  ding: c => schedule(c, [
    { freq: 1200, delay: 0, dur: 0.6, vol: 0.22 },
  ]),

  // Boop — três pulsos ascendentes (som atual de cutucar)
  boop: c => schedule(c, [
    { freq: 300, delay: 0,    dur: 0.18, vol: 0.35, type: "triangle" },
    { freq: 500, delay: 0.12, dur: 0.18, vol: 0.35, type: "triangle" },
    { freq: 700, delay: 0.24, dur: 0.18, vol: 0.35, type: "triangle" },
  ]),

  none: () => { /* silêncio */ },
};

export async function playSound(preset: SoundPreset | string): Promise<void> {
  const p = (SOUND_OPTIONS.find(o => o.value === preset) ? preset : "ping") as SoundPreset;
  if (p === "none") return;
  const c = await ctx();
  if (!c) return;
  try { PRESETS[p](c); } catch { /* ignore */ }
}
