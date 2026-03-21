/**
 * @file Setup/index.jsx
 * @description Setup wizard controller. Manages step state and passes data between
 * the 6 wizard screens: Welcome → Hardware → Capabilities → Models → Installing → Ready.
 *
 * State flows forward only — users cannot go back past the installing step.
 * On completion, dispatching completeSetup() in ReadyScreen switches App.jsx to
 * the main application shell.
 */

import React, { useState } from 'react';
import WelcomeScreen from './WelcomeScreen';
import HardwareScreen from './HardwareScreen';
import CapabilitiesScreen from './CapabilitiesScreen';
import ModelsScreen from './ModelsScreen';
import InstallingScreen from './InstallingScreen';
import ReadyScreen from './ReadyScreen';

const TOTAL_STEPS = 6;

/** Progress dots shown between screens 1–4 (not on welcome/ready). */
function ProgressDots({ step }) {
  if (step === 0 || step >= TOTAL_STEPS - 1) return null;
  return (
    <div className="flex justify-center pt-6 gap-2">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
            i <= step ? 'bg-violet-500' : 'bg-zinc-700'
          }`}
        />
      ))}
    </div>
  );
}

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [hardware, setHardware] = useState(null);
  const [capabilities, setCapabilities] = useState(['chat', 'coding']);
  const [recommendations, setRecommendations] = useState(null);
  const [models, setModels] = useState({});

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="flex flex-col h-screen bg-[#0f0f11] text-zinc-100">
      <ProgressDots step={step} />

      <div className="flex-1 overflow-hidden">
        {step === 0 && <WelcomeScreen onNext={next} />}

        {step === 1 && (
          <HardwareScreen
            onNext={next}
            onHardware={setHardware}
          />
        )}

        {step === 2 && (
          <CapabilitiesScreen
            hardware={hardware}
            capabilities={capabilities}
            onCapabilities={setCapabilities}
            onNext={next}
            onBack={back}
          />
        )}

        {step === 3 && (
          <ModelsScreen
            capabilities={capabilities}
            recommendations={recommendations}
            onRecommendations={setRecommendations}
            models={models}
            onModels={setModels}
            onNext={next}
            onBack={back}
          />
        )}

        {step === 4 && (
          <InstallingScreen
            capabilities={capabilities}
            models={models}
            onDone={next}
          />
        )}

        {step === 5 && <ReadyScreen />}
      </div>
    </div>
  );
}
