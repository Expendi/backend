import "../styles/bottom-sheet.css";

interface StepIndicatorProps {
  steps: number;
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="step-indicator" role="progressbar" aria-valuenow={current + 1} aria-valuemin={1} aria-valuemax={steps}>
      {Array.from({ length: steps }, (_, i) => {
        let className = "step-dot";
        if (i < current) {
          className += " step-dot-completed";
        } else if (i === current) {
          className += " step-dot-active";
        }
        return <div key={i} className={className} />;
      })}
    </div>
  );
}
