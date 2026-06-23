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
  /** Called when the user disconnects the wallet (clears local connection state). */
  onDisconnect?: () => void
  /** Connected wallet's USDC balance, formatted (e.g. "3.0000000"), or null until loaded. */
  usdcBalance?: string | null
}

/**
 * ConnectFreighter — Freighter wallet connect / status.
 *
 * Not connected: a single "Connect Freighter" CTA.
 * Connected: one cohesive status chip — a live-connection dot, the truncated
 * address, the wallet's USDC balance, and a quiet Disconnect action, all inside
 * one hairline pill (no floating, disconnected blobs).
 */
export function ConnectFreighter({
  address,
  connecting,
  error,
  onConnect,
  onDisconnect,
  usdcBalance,
}: ConnectFreighterProps) {
  const isConnected = address !== null && !connecting

  const displayAddress = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null

  // Trim formatUsdc's trailing zeros for display: "3.0000000" → "3", "2.5000000" → "2.5".
  const balanceLabel =
    usdcBalance === null || usdcBalance === undefined
      ? '…'
      : usdcBalance.replace(/\.?0+$/, '') || '0'

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-3 self-start">
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="bg-accent-fill text-white font-[900] text-base px-6 h-[52px] rounded-full hover:opacity-90 active:scale-[0.98] transition-all self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
        >
          {connecting ? 'Connecting…' : 'Connect Freighter'}
        </button>
        {error && <p className="text-xs text-accent-warm">{error}</p>}
      </div>
    )
  }

  // Connected — one unified wallet chip.
  return (
    <div className="flex flex-col gap-3 self-start">
      <div className="inline-flex items-center self-start h-12 pl-4 pr-1.5 gap-3 rounded-full bg-surface ring-1 ring-hairline">
        {/* Live-connection signal */}
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-accent-soft shadow-[0_0_6px] shadow-accent-soft/60"
        />

        {/* Address */}
        <span className="font-mono text-sm text-ink" title={address ?? undefined}>
          {displayAddress}
        </span>

        {/* Divider */}
        <span aria-hidden className="h-4 w-px bg-white/10" />

        {/* Balance — amber at 0 so an unfundable wallet reads as a blocker, not a
            passive figure. The title labels the otherwise-bare number. */}
        <span
          className={`font-mono text-sm tabular-nums ${
            balanceLabel === '0' ? 'text-accent-warm' : 'text-ink-muted'
          }`}
          title="USDC available to pay"
        >
          {balanceLabel}{' '}
          <span className={balanceLabel === '0' ? 'text-accent-warm/70' : 'text-ink-muted/70'}>
            USDC
          </span>
        </span>

        {/* Disconnect */}
        {onDisconnect && (
          <button
            type="button"
            onClick={onDisconnect}
            title="Disconnect wallet"
            className="ml-0.5 h-9 px-3 rounded-full text-xs text-ink-muted hover:text-ink hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Disconnect
          </button>
        )}
      </div>

      {error && <p className="text-xs text-accent-warm">{error}</p>}
    </div>
  )
}
