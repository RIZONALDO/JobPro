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
  if (hoursToday === 0)     return { label: "disponível",    color: "hsl(var(--primary))", order: 0 };
  if (hoursToday < cap / 2) return { label: "ocupado",       color: "#facc15",             order: 1 };
  if (hoursToday < cap)     return { label: "muito ocupado", color: "#fb923c",             order: 2 };
  return                           { label: "no limite",     color: "#f87171",             order: 3 };
}

const DOW_PT = ["dom","seg","ter","qua","qui","sex","sáb"];
const MON_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
function fmtToday() { const d=new Date(); return `${DOW_PT[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}/${MON_PT[d.getMonth()]}`; }
function fmtHoliday(s:string){const d=parseDate(s);return{dow:DOW_PT[d.getDay()],day:String(d.getDate()).padStart(2,"0"),mon:MON_PT[d.getMonth()],year:String(d.getFullYear())};}

function Avatar({ name, avatarUrl, size=40 }:{name:string;avatarUrl:string|null;size?:number}) {
  const initials=name.split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  if(avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full"/>;
  const bg=["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0)%8];
  return <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full" style={{background:bg,fontSize:size*0.36}}>{initials}</div>;
}

function HolidayPanel() {
  const [holidays,setHolidays]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [newDate,setNewDate]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);
  const today=todayStr();
  useEffect(()=>{apiFetch<{holidays:string[]}>("/api/calendar-config").then(d=>setHolidays(d.holidays??[])).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const save=async(list:string[])=>{setSaving(true);try{const r=await apiPut<{holidays:string[]}>("/api/calendar-config",{holidays:list});setHolidays(r.holidays);}catch{}finally{setSaving(false);}};
  const future=holidays.filter(h=>h>=today).sort();
  const past=holidays.filter(h=>h<today).sort().reverse().slice(0,5);
  return(
    <div className="mt-14 max-w-sm">
      <div className="flex items-center gap-3 mb-6"><CalendarOff className="h-4 w-4" style={{color:"hsl(var(--muted-foreground))"}}/><p className="text-xs font-black uppercase tracking-widest" style={{color:"hsl(var(--muted-foreground))"}}>feriados</p><span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{background:"hsl(var(--primary)/0.1)",color:"hsl(var(--primary))"}}>supervisor</span></div>
      <div className="flex gap-2 mb-6"><input ref={inputRef} type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(save([...holidays,newDate].sort()),setNewDate(""))} className="flex-1 h-10 px-3 text-sm rounded-xl focus:outline-none" style={{background:"hsl(var(--muted))",border:"1px solid hsl(var(--border))",color:"hsl(var(--foreground))"}}/><button onClick={()=>{if(!newDate||holidays.includes(newDate))return;save([...holidays,newDate].sort());setNewDate("");}} disabled={!newDate||saving} className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30" style={{background:"hsl(var(--primary))"}}><Plus className="h-4 w-4 text-white"/></button></div>
      {loading?[...Array(2)].map((_,i)=><div key={i} className="h-11 rounded-xl animate-pulse mb-2" style={{background:"hsl(var(--muted))"}}/>):future.length===0?<p className="text-sm" style={{color:"hsl(var(--muted-foreground)/0.4)"}}>nenhum feriado cadastrado.</p>:<div className="space-y-2">{future.map(date=>{const{dow,day,mon,year}=fmtHoliday(date);return(<div key={date} className="flex items-center gap-3 rounded-xl px-4 py-2.5" style={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))"}}>  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:"#f59e0b"}}/><span className="text-[9px] font-black uppercase tracking-widest w-6" style={{color:"hsl(var(--muted-foreground)/0.5)"}}>{dow}</span><span className="text-sm font-black tabular-nums flex-1">{day} <span className="font-medium text-xs" style={{color:"hsl(var(--muted-foreground))"}}>{mon}{year!==String(new Date().getFullYear())?` ${year}`:""}</span></span><button onClick={()=>save(holidays.filter(h=>h!==date))} disabled={saving} className="h-6 w-6 rounded-lg flex items-center justify-center hover:opacity-60 disabled:opacity-30" style={{background:"hsl(var(--muted))"}}><X className="h-3 w-3" style={{color:"hsl(var(--muted-foreground))"}}/></button></div>);})}</div>}
      {past.length>0&&<div className="mt-4 space-y-1"><p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{color:"hsl(var(--muted-foreground)/0.3)"}}>anteriores</p>{past.map(date=>{const{dow,day,mon}=fmtHoliday(date);return(<div key={date} className="flex items-center gap-3 px-3 py-1.5 rounded-lg opacity-35"><span className="text-[9px] font-black uppercase tracking-widest w-6" style={{color:"hsl(var(--muted-foreground))"}}>{dow}</span><span className="text-xs font-bold tabular-nums flex-1">{day} {mon}</span><button onClick={()=>save(holidays.filter(h=>h!==date))} disabled={saving} className="h-5 w-5 rounded flex items-center justify-center hover:opacity-60"><X className="h-3 w-3" style={{color:"hsl(var(--muted-foreground))"}}/></button></div>);})}</div>}
    </div>
  );
}

export default function EscalaBoardV3() {
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

  // Segmenta por status
  const groups = [
    { key: "disponível",    items: filtered.filter(e => scoreInfo(e.hoursToday,e.dailyCap).order===0), color: "hsl(var(--primary))" },
    { key: "ocupado",       items: filtered.filter(e => scoreInfo(e.hoursToday,e.dailyCap).order===1), color: "#facc15" },
    { key: "muito ocupado", items: filtered.filter(e => scoreInfo(e.hoursToday,e.dailyCap).order===2), color: "#fb923c" },
    { key: "no limite",     items: filtered.filter(e => scoreInfo(e.hoursToday,e.dailyCap).order===3), color: "#f87171" },
  ].filter(g => g.items.length > 0);

  return (
    <div ref={pageRef} className="min-h-screen max-w-2xl mx-auto">

      {/* Header sticky */}
      <div className="sticky top-0 z-10 px-6 pt-8 pb-4"
        style={{ background: "hsl(var(--background)/0.92)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-baseline justify-between mb-3">
          <h1 className="text-6xl font-black tracking-tighter leading-none" style={{ letterSpacing: "-0.04em" }}>
            agenda
          </h1>
          <span className="text-xs font-black tabular-nums" style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>
            {fmtToday()}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
            style={{ color: "hsl(var(--muted-foreground))" }} />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="buscar editor…"
            className="w-full h-9 pl-10 pr-4 rounded-full text-sm focus:outline-none"
            style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
        </div>
      </div>

      {/* Corpo */}
      <div className="px-6 pb-10">
        {loading ? (
          <div className="space-y-px mt-2">
            {[...Array(7)].map((_,i) => (
              <div key={i} className="h-14 animate-pulse" style={{ background: "hsl(var(--muted)/0.5)" }} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>nenhum editor</p>
        ) : (
          <div className="space-y-6 mt-2">
            {groups.map(group => (
              <div key={group.key}>
                {/* Label do grupo */}
                <div className="flex items-center gap-2 mb-1 px-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: group.color }} />
                  <span className="text-[9px] font-black uppercase tracking-[0.15em]"
                    style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>
                    {group.key} · {group.items.length}
                  </span>
                </div>

                {/* Itens do grupo — tabela compacta */}
                <div className="rounded-2xl overflow-hidden"
                  style={{ border: "1px solid hsl(var(--border))" }}>
                  {group.items.map((editor, idx) => {
                    const cap = editor.dailyCap || 8;
                    const pct = Math.min(100, Math.round(editor.hoursToday / cap * 100));
                    return (
                      <button key={editor.id}
                        onClick={() => navigate(`/agenda/${editor.id}`)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100"
                        style={{
                          background: "hsl(var(--card))",
                          borderTop: idx > 0 ? "1px solid hsl(var(--border)/0.5)" : "none",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted)/0.5)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "hsl(var(--card))"; }}
                      >
                        {/* Avatar pequeno */}
                        <div style={{ width: 32, height: 32, flexShrink: 0 }}>
                          <div className="w-full h-full rounded-full overflow-hidden"
                            style={{ boxShadow: `0 0 0 1.5px ${group.color}` }}>
                            <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={32} />
                          </div>
                        </div>

                        {/* Nome */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black truncate leading-tight">{editor.name}</p>
                        </div>

                        {/* Barra de horas inline */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: group.color, minWidth: pct > 0 ? 3 : 0 }} />
                          </div>
                          <span className="text-[10px] font-mono w-8 text-right" style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>
                            {editor.hoursToday}h
                          </span>
                        </div>

                        {/* Tasks breakdown */}
                        <div className="flex gap-1 shrink-0">
                          {editor.byStatus.pending > 0 && (
                            <span className="text-[8px] font-black tabular-nums w-5 h-5 rounded flex items-center justify-center"
                              style={{ background: "#fef3c730", color: "#d97706" }}>{editor.byStatus.pending}</span>
                          )}
                          {editor.byStatus.in_progress > 0 && (
                            <span className="text-[8px] font-black tabular-nums w-5 h-5 rounded flex items-center justify-center"
                              style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>{editor.byStatus.in_progress}</span>
                          )}
                          {editor.byStatus.review > 0 && (
                            <span className="text-[8px] font-black tabular-nums w-5 h-5 rounded flex items-center justify-center"
                              style={{ background: "#f3e8ff30", color: "#9333ea" }}>{editor.byStatus.review}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {isSupervisor && <HolidayPanel />}
      </div>
    </div>
  );
}
