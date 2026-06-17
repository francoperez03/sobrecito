/**
 * Legacy per-token route retired in 06.3 (stable-key dashboard at /employee). See CONTEXT.md route decision.
 *
 * The old model (/employee/[token] with a per-note notePrivkeyHex embedded in the
 * URL token) is replaced by the stable-key dashboard at /employee. Any link that
 * still uses the old pattern is redirected here automatically.
 */
import { redirect } from 'next/navigation'

export default function LegacyEmployeeToken() {
  redirect('/employee')
}
