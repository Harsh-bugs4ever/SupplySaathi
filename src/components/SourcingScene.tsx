'use client';
import { useState } from 'react';
const STAGES = [
  { name: 'Discover', detail: 'Search supplier pages for your product.' },
  { name: 'Verify', detail: 'Check dimensions, quantity, and delivery evidence.' },
  { name: 'Compare', detail: 'Put costs and unanswered questions side by side.' },
];
/** Interactive process diagram. Does not represent live supplier activity. */
export function SourcingScene() {
  const [stage, setStage] = useState(0);
  return <section className="network-panel" aria-label="How sourcing works">
    <div className="network-caption"><span>THE SOURCING ENGINE</span><span>PROCESS MAP</span></div>
    <div className="network-visual" aria-hidden="true">
      <div className="network-ring ring-a" /><div className="network-ring ring-b" /><div className="network-ring ring-c" />
      <svg className="network-lines" viewBox="0 0 400 280"><path d="M70 65 200 140 333 58M60 210 200 140 330 217M200 140V25M200 140v115" /></svg>
      <span className="network-node node-a">PRODUCT</span><span className="network-node node-b">SUPPLIERS</span><span className="network-node node-c">EVIDENCE</span><span className="network-node node-d">YOUR BRIEF</span>
      <div className="network-core"><span>ss<span className="core-period">.</span></span><small>{STAGES[stage].name}</small></div>
    </div>
    <div className="network-tabs" role="tablist" aria-label="Sourcing stages">{STAGES.map((item, index) => <button key={item.name} type="button" role="tab" id={`stage-${index}`} aria-controls="stage-detail" aria-selected={stage === index} onClick={() => setStage(index)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setStage(next); document.getElementById(`stage-${next}`)?.focus(); } }} tabIndex={stage === index ? 0 : -1}><span>0{index + 1}</span>{item.name}</button>)}</div>
    <p id="stage-detail" role="tabpanel" aria-labelledby={`stage-${stage}`} className="network-description">{STAGES[stage].detail}</p>
  </section>;
}
