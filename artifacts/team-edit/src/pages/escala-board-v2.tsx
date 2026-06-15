import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Plus, X, CalendarOff } from "lucide-react";
import { apiFetch, apiPut } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { todayStr, parseDate } from "@/lib/date";

interface WorkloadEditor {
  id: number; name: string; login: string; avatarUrl: string | null;
  hoursToday: number; dailyCap: number; taskCount: number;
  byStatus: { pending: number; in_progress: number; review: number };
}

function scoreInfo(hoursToday: number, dailyCap: number) {
  const cap = dailyCap || 8;
  if (hoursToday === 0)     return { label: "disponível",    color: "hsl(var(--primary))", order: 0, pct: 0 };
  if (hoursToday < cap / 2) return { label: "ocupado",       color: "#facc15",             order: 1, pct: Math.round(hoursToday/cap*100) };
  if (hoursToday < cap)     return { label: "muito ocupado", color: "#fb923c",             order: 2, pct: Math.round(hoursToday/cap*100) };
  return                           { label: "no limite",     color: "#f87171",             order: 3, pct: 100 };
}

const DOW_PT = ["dom","seg","ter","qua","qui","sex","sáb"];
const MON_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

function fmtToday() {
  const d = new Date();
  return `${DOW_PT[d.getDay()]} ${String(d.getDate()).padStart(2,"0")} ${MON_PT[d.getMonth()]}`;
}
function fmtHoliday(dateStr: string) {
  const d = parseDate(dateStr);
  return { dow: DOW_PT[d.getDay()], day: String(d.getDate()).padStart(2,"0"), mon: MON_PT[d.getMonth()], year: String(d.getFullYear()) };
}

function Avatar({ name, avatarUrl, size = 40 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full" />;
  const bg = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0)%8];
  return <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full" style={{ background: bg, fontSize: size * 0.36 }}>{initials}</div>;
}

function HolidayPanel() {
  const [holidays, setHolidays] = useState<string[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [newDate,  setNewDate]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayStr();

  useEffect(() => {
    apiFetch<{ holidays: string[] }>("/api/calendar-config")
      .then(d => setHolidays(d.holidays ?? [])).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  const save = async (list: string[]) => {
    setSaving(true);
    try { const res = await apiPut<{ holidays: string[] }>("/api/calendar-config",{ holidays: list }); setHolidays(res.holidays); }
    catch {} finally { setSaving(false); }
  };

  const future = holidays.filter(h=>h>=today).sort();
  const past   = holidays.filter(h=>h<today).sort().reverse().slice(0,5);

  return (
    <div className="mt-14 max-w-sm">
      <div className="flex items-center gap-3 mb-6">
        <CalendarOff className="h-4 w-4" style={{ color: "hsl(var(--muted-foreground))" }} />
        <p className="text-xs font-black uppercase tracking-widest" style={{ color: "hsl(var(--muted-foreground))" }}>feriados</p>
        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>supervisor</span>
      </div>
      <div className="flex gap-2 mb-6">
        <input ref={inputRef} type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save([...holidays,newDate].sort())&&setNewDate("")}
          className="flex-1 h-10 px-3 text-sm rounded-xl focus:outline-none"
          style={{ background:"hsl(var(--muted))", border:"1px solid hsl(var(--border))", color:"hsl(var(--foreground))" }} />
        <button onClick={()=>{if(!newDate||holidays.includes(newDate))return;save([...holidays,newDate].sort());setNewDate("");}} disabled={!newDate||saving}
          className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30" style={{ background:"hsl(var(--primary))" }}>
          <Plus className="h-4 w-4 text-white" />
        </button>
      </div>
      {loading ? [...Array(2)].map((_,i)=><div key={i} className="h-11 rounded-xl animate-pulse mb-2" style={{ background:"hsl(var(--muted))" }} />) :
        future.length===0 ? <p className="text-sm" style={{ color:"hsl(var(--muted-foreground)/0.4)" }}>nenhum feriado cadastrado.</p> :
        <div className="space-y-2">{future.map(date=>{const{dow,day,mon,year}=fmtHoliday(date);return(
          <div key={date} className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={{ background:"hsl(var(--card))", border:"1px solid hsl(var(--border))" }}>
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:"#f59e0b" }} />
            <span className="text-[9px] font-black uppercase tracking-widest w-6" style={{ color:"hsl(var(--muted-foreground)/0.5)" }}>{dow}</span>
            <span className="text-sm font-black tabular-nums flex-1">{day} <span className="font-medium text-xs" style={{ color:"hsl(var(--muted-foreground))" }}>{mon}{year!==String(new Date().getFullYear())?` ${year}`:""}</span></span>
            <button onClick={()=>save(holidays.filter(h=>h!==date))} disabled={saving} className="h-6 w-6 rounded-lg flex items-center justify-center hover:opacity-60 disabled:opacity-30" style={{ background:"hsl(var(--muted))" }}>
              <X className="h-3 w-3" style={{ color:"hsl(var(--muted-foreground))" }} />
            </button>
          </div>);})}</div>}
      {past.length>0&&<div className="mt-4 space-y-1"><p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color:"hsl(var(--muted-foreground)/0.3)" }}>anteriores</p>
        {past.map(date=>{const{dow,day,mon}=fmtHoliday(date);return(<div key={date} className="flex items-center gap-3 px-3 py-1.5 rounded-lg opacity-35">
          <span className="text-[9px] font-black uppercase tracking-widest w-6" style={{ color:"hsl(var(--muted-foreground))" }}>{dow}</span>
          <span className="text-xs font-bold tabular-nums flex-1">{day} {mon}</span>
          <button onClick={()=>save(holidays.filter(h=>h!==date))} disabled={saving} className="h-5 w-5 rounded flex items-center justify-center hover:opacity-60"><X className="h-3 w-3" style={{ color:"hsl(var(--muted-foreground))" }} /></button>
        </div>);})}
      </div>}
    </div>
  );
}

export default function EscalaBoardV2() {
  usePageTitle("Agenda");
  const [, navigate] = useLocation();
  const { user }     = useAuth();
  const [editors, setEditors] = useState<WorkloadEditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const pageRef = useRef<HTMLDivElement>(null);

  const isSupervisor = user?.role === "supervisor" || user?.role === "admin";

  useEffect(() => {
    let el: HTMLElement | null = pageRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === "auto" || overflowY === "scroll") { el.scrollTop = 0; break; }
      el = el.parentElement;
    }
  }, []);

  useEffect(() => {
    apiFetch<WorkloadEditor[]>("/api/workload").then(setEditors).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  const filtered = editors
    .filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || e.login.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => scoreInfo(a.hoursToday,a.dailyCap).order - scoreInfo(b.hoursToday,b.dailyCap).order);

  return (
    <div ref={pageRef} className="min-h-screen px-5 py-10 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-7xl font-black tracking-tighter leading-none" style={{ letterSpacing:"-0.04em" }}>agenda</h1>
          <p className="text-xs font-bold uppercase tracking-widest mt-2" style={{ color:"hsl(var(--muted-foreground))" }}>{fmtToday()}</p>
        </div>

        {/* Total editors pill */}
        {!loading && (
          <div className="rounded-2xl px-5 py-3 text-right" style={{ background:"hsl(var(--muted)/0.5)" }}>
            <p className="text-3xl font-black tabular-nums leading-none">{editors.length}</p>
            <p className="text-[9px] font-black uppercase tracking-widest mt-1" style={{ color:"hsl(var(--muted-foreground))" }}>editores</p>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color:"hsl(var(--muted-foreground))" }} />
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="buscar…"
          className="w-full h-10 pl-11 pr-4 rounded-full text-sm font-medium focus:outline-none"
          style={{ background:"hsl(var(--muted))", border:"1px solid hsl(var(--border))", color:"hsl(var(--foreground))" }} />
      </div>

      {/* Grid 2 colunas */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_,i)=><div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background:"hsl(var(--muted))" }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(editor => {
            const { label, color, pct } = scoreInfo(editor.hoursToday, editor.dailyCap);
            const firstName = editor.name.split(" ")[0];
            return (
              <button key={editor.id} onClick={()=>navigate(`/agenda/${editor.id}`)}
                className="group rounded-2xl p-4 text-left flex flex-col gap-3 transition-all duration-150 cursor-pointer"
                style={{ background:"hsl(var(--card))", border:"1px solid hsl(var(--border))" }}
                onMouseEnter={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor=`${color}60`;el.style.boxShadow=`0 4px 20px ${color}20`;el.style.transform="translateY(-2px)";}}
                onMouseLeave={e=>{const el=e.currentTarget as HTMLElement;el.style.borderColor="hsl(var(--border))";el.style.boxShadow="";el.style.transform="";}}>

                {/* Top: avatar + badge */}
                <div className="flex items-center justify-between">
                  <div style={{ width:40, height:40 }}>
                    <div className="w-full h-full rounded-full overflow-hidden" style={{ boxShadow:`0 0 0 2px ${color}` }}>
                      <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={40} />
                    </div>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ background:`${color}18`, color }}>
                    {label}
                  </span>
                </div>

                {/* Name */}
                <div>
                  <p className="text-sm font-black leading-tight truncate">{firstName}</p>
                  <p className="text-[10px] font-mono truncate mt-0.5" style={{ color:"hsl(var(--muted-foreground))" }}>{editor.login}</p>
                </div>

                {/* Workload bar */}
                <div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background:"hsl(var(--muted))" }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width:`${pct}%`, background: color, minWidth: pct > 0 ? 4 : 0 }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] font-mono" style={{ color:"hsl(var(--muted-foreground)/0.5)" }}>
                      {editor.hoursToday}h / {editor.dailyCap}h
                    </span>
                    <span className="text-[9px] font-black font-mono" style={{ color:"hsl(var(--muted-foreground)/0.5)" }}>
                      {editor.taskCount} tarefa{editor.taskCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {isSupervisor && <HolidayPanel />}
    </div>
  );
}
