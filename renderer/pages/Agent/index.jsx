/**
 * @file Agent/index.jsx
 * @description Agent panel: goal input, execution log, sandboxed workspace viewer,
 * and tool permission controls. The agent is confined to a sandboxed workspace
 * directory by default; each tool type requires explicit user permission.
 *
 * TODO Phase 7: implement. Agent framework TBD (Open Interpreter vs custom).
 */

import React from 'react';

export default function AgentPanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <p className="text-white/60 text-sm">Agent automation is not available in this version.</p>
      <p className="text-white/40 text-xs">Autonomous agent capabilities are coming in a future release.</p>
    </div>
  );
}
