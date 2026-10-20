import { Pause, Play } from 'lucide-react';

export function MotionToggle({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const label = paused ? 'Відновити анімації' : 'Призупинити анімації';
  return <button className="icon-button motion-switch" aria-label={label} title={label} onClick={onToggle}>
    {paused ? <Play size={17} aria-hidden="true"/> : <Pause size={17} aria-hidden="true"/>}
  </button>;
}
