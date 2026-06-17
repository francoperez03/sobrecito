'use client'

export interface ConnectFreighterProps {
  /** Connected wallet address, or null when not yet connected. */
  address: string | null
  /** True while a connection is in progress. */
  connecting: boolean
  /** Error message to display below the button, or null when no error. */
  error: string | null
  /** Called when the user clicks the connect button. */
  onConnect: () => void
}

/**
 * ConnectFreighter — presentational Freighter wallet connect button.
 *
 * Reflects three states:
 *   - Not connected: shows "Connect Freighter" CTA.
 *   - Connecting: shows "Connecting…" with button disabled.
 *   - Connected: shows a truncated wallet address.
 *
 * The actual connect logic lives in employer-deposit.ts (connectFreighter) and
 * is invoked by PayrollComposer (plan 06) via onConnect. This component owns
 * only presentation.
 *
 * Error text renders in amber below the button (exposure/danger per DESIGN.md).
 */
export function ConnectFreighter({
  address,
  connecting,
  error,
  onConnect,
}: ConnectFreighterProps) {
  const isConnected = address !== null && !connecting

  // Truncate address to first 4 + last 4 chars for display
  const displayAddress = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null

  return (
    <div className="flex flex-col gap-3 self-start">
      <button
        type="button"
        onClick={onConnect}
        disabled={connecting || isConnected}
        className="bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
      >
        {connecting
          ? 'Connecting…'
          : isConnected
            ? displayAddress
            : 'Connect Freighter'}
      </button>

      {error && (
        <p className="text-xs text-accent-warm">{error}</p>
      )}
    </div>
  )
}
