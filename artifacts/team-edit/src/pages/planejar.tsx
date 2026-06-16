/**
 * Planejar com ESCALA — página dedicada ao algoritmo de agendamento.
 *
 * Separada do quadro de visualização intencionalmente:
 * o algoritmo vive aqui, o quadro é só retrato.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { usePageTitle } from "@/lib/use-page-title";
import { EscalaModal, type QuizStep } from "@/components/EscalaModal";

export default function PlanejarPage() {
  usePageTitle("Planejar");
  const [, navigate] = useLocation();

  const [open,        setOpen]        = useState(true);
  const [currentStep, setCurrentStep] = useState<QuizStep>("q1");

  const isResults = currentStep === "results";

  const handleClose = () => {
    setOpen(false);
    navigate("/agenda");
  };

  const handleCreated = ({ editorId, firstDate, taskId }: { editorId: number; firstDate: string; taskId: number }) => {
    navigate(`/agenda?editor=${editorId}${firstDate ? `&date=${firstDate}` : ""}&task=${taskId}`);
  };

  return (
    <div
      className="min-h-full flex flex-col items-center justify-start pt-10 pb-16 px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Header — compacto quando expandido */}
      {!isResults && (
        <div className="w-full max-w-md mb-6 text-center">
          <h1 className="text-2xl font-black tracking-tight">Planejar tarefa</h1>
          <p className="text-[13px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            Diz o que precisa, o algoritmo encontra o melhor encaixe na fila de cada editor.
          </p>
        </div>
      )}

      {isResults && (
        <div className="w-full mb-4 text-center" style={{ maxWidth: "1040px" }}>
          <h1 className="text-xl font-black tracking-tight">Escolha o editor</h1>
        </div>
      )}

      {/* Wizard inline */}
      <div
        className={`w-full ${isResults ? "" : "rounded-3xl overflow-hidden"}`}
        style={{
          maxWidth:   isResults ? "1040px" : "448px",
          transition: "max-width 0.35s cubic-bezier(0.4,0,0.2,1)",
          ...(isResults ? {} : {
            background: "hsl(var(--card))",
            border:     "1px solid hsl(var(--border))",
            boxShadow:  "0 24px 64px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.03)",
          }),
        }}
      >
        <EscalaModal
          open={open}
          onClose={handleClose}
          onCreated={handleCreated}
          onStepChange={setCurrentStep}
          mode="page"
        />
      </div>

      {/* Link de volta */}
      <button
        onClick={handleClose}
        className="mt-6 text-[12px] transition-colors"
        style={{ color: "hsl(var(--muted-foreground)/0.55)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--foreground))")}
        onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--muted-foreground)/0.55)")}
      >
        ← voltar para o quadro
      </button>
    </div>
  );
}
