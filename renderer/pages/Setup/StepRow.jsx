/**
 * @file StepRow.jsx
 * @description A single installation step row used by InstallingScreen.
 * Shows a status icon (pending, in-progress, done, error), a step label,
 * and the most recent progress message for that step.
 */

import React from 'react';

/**
 * Status icon for a single install step.
 *
 * @param {{ status: 'pending'|'in-progress'|'done'|'error' }} props
 */
function StepIcon({ status }) {
  if (status === 'pending') {
    return (
      <div className="w-4 h-4 rounded-full border border-zinc-700 flex-shrink-0" />
    );
  }
  if (status === 'in-progress') {
    return (
      <div className="w-4 h-4 border-2 border-zinc-600 border-t-violet-500 rounded-full animate-spin flex-shrink-0" />
    );
  }
  if (status === 'done') {
    return (
      <div className="w-4 h-4 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center flex-shrink-0">
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round">
          <polyline points="2,5 4,7 8,3" />
        </svg>
      </div>
    );
  }
  // error
  return (
    <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center flex-shrink-0">
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="3" x2="7" y2="7" />
        <line x1="7" y1="3" x2="3" y2="7" />
      </svg>
    </div>
  );
}

/**
 * A single installation step row with status icon, label, and message.
 *
 * @param {{
 *   label: string,
 *   status: 'pending'|'in-progress'|'done'|'error',
 *   message: string,
 * }} props
 */
export default function StepRow({ label, status, message }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">
        <StepIcon status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${
          status === 'done'       ? 'text-zinc-300' :
          status === 'in-progress'? 'text-white'    :
          status === 'error'      ? 'text-red-400'  :
          'text-zinc-500'
        }`}>
          {label}
        </p>
        {message && (
          <p className="text-xs text-zinc-600 mt-0.5 truncate">{message}</p>
        )}
      </div>
    </div>
  );
}
