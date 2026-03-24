/**
 * @file Setup/index.jsx
 * @description Setup wizard controller. Manages step state and passes data between
 * the 8 wizard screens:
 *   0 Welcome → 1 Prerequisites → 2 Hardware → 3 Capabilities → 4 InstallLocation
 *   → 5 Models → 6 Installing → 7 Ready
 *
 * State flows forward only — users cannot go back past the installing step.
 * On completion, dispatching completeSetup() in ReadyScreen switches App.jsx to
 * the main application shell.
 */

import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setInstallDir,
  setSelectedCapabilities,
  markServiceInstalled,
  setServicePath,
} from '../../store/slices/settings';
import WelcomeScreen from './WelcomeScreen';
import PrereqScreen from './PrereqScreen';
import HardwareScreen from './HardwareScreen';
import CapabilitiesScreen from './CapabilitiesScreen';
import InstallLocationScreen from './InstallLocationScreen';
import ModelsScreen from './ModelsScreen';
import InstallingScreen from './InstallingScreen';
import ReadyScreen from './ReadyScreen';

const TOTAL_STEPS = 8;

/** Progress dots shown between screens 1–6 (not on welcome/ready). */
function ProgressDots({ step }) {
  if (step === 0 || step >= TOTAL_STEPS - 1) return null;
  return (
    <div className="flex justify-center pt-6 gap-2">
      {[1, 2, 3, 4, 5, 6].map((i) => (
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
  const dispatch     = useDispatch();
  const installedServices = useSelector((s) => s.settings.installedServices);

  const [step, setStep]               = useState(0);
  const [hardware, setHardware]       = useState(null);
  const [capabilities, setCapabilities] = useState(['chat', 'coding']);
  const [recommendations, setRecommendations] = useState(null);
  const [models, setModels]           = useState({});
  const [installDir, setInstallDirLocal] = useState(null);

  const nextStep = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  /** Listen for service install completion events from the main process. */
  useEffect(() => {
    const unsub = window.electronAPI.on(
      'install-service-complete',
      ({ service, executablePath }) => {
        dispatch(markServiceInstalled({ service }));
        if (executablePath) dispatch(setServicePath({ service, executablePath }));
      }
    );
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [dispatch]);

  /** Handle capabilities selection: update local state and persist to Redux. */
  function handleCapabilities(caps) {
    setCapabilities(caps);
    dispatch(setSelectedCapabilities(caps));
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f0f11] text-zinc-100">
      <ProgressDots step={step} />

      <div className="flex-1 overflow-hidden">
        {step === 0 && <WelcomeScreen onNext={nextStep} />}

        {step === 1 && (
          <PrereqScreen
            onNext={nextStep}
            selectedCapabilities={capabilities}
          />
        )}

        {step === 2 && (
          <HardwareScreen
            onNext={nextStep}
            onHardware={setHardware}
          />
        )}

        {step === 3 && (
          <CapabilitiesScreen
            hardware={hardware}
            capabilities={capabilities}
            onCapabilities={handleCapabilities}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}

        {step === 4 && (
          <InstallLocationScreen
            onNext={(dir) => {
              setInstallDirLocal(dir);
              dispatch(setInstallDir(dir));
              nextStep();
            }}
            onBack={prevStep}
            selectedCapabilities={capabilities}
          />
        )}

        {step === 5 && (
          <ModelsScreen
            capabilities={capabilities}
            recommendations={recommendations}
            onRecommendations={setRecommendations}
            models={models}
            onModels={setModels}
            onNext={nextStep}
            onBack={prevStep}
            installDir={installDir}
          />
        )}

        {step === 6 && (
          <InstallingScreen
            capabilities={capabilities}
            models={models}
            installDir={installDir}
            installedServices={installedServices}
            onDone={nextStep}
          />
        )}

        {step === 7 && <ReadyScreen />}
      </div>
    </div>
  );
}
