/**
 * @file Setup/index.jsx
 * @description Setup wizard entry point. Routes between the 6 wizard screens:
 *   1. Welcome
 *   2. Hardware (runs hardware scan)
 *   3. Capabilities (checkbox selection)
 *   4. Models (recommendations + cloud key input)
 *   5. Installing (progress bar, streaming install events)
 *   6. Ready (health check confirms all services up)
 *
 * TODO Phase 3: implement all 6 screens.
 */

import React from 'react';

export default function SetupWizard() {
  // TODO Phase 3
  return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
      Setup wizard — Phase 3
    </div>
  );
}
