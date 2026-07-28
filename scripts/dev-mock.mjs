/**
 * Development run with both external dependencies mocked.
 *
 * WHY a script rather than inline env vars in package.json: npm runs scripts
 * through cmd.exe on Windows and sh elsewhere, and the two disagree about how to
 * set a variable for one command. Setting them here means the same entry point
 * works from PowerShell, cmd and Git Bash.
 *
 * License keys accepted by the mock are prefix-driven — see
 * electron/main/services/license/mock.ts and the README's "Running without a
 * license server" section.
 */
import { spawn } from 'node:child_process'

const mockEnv = {
  LICENSE_SERVICE: 'mock',
  WA_TRANSPORT: 'mock',
}

// Anything the caller already set wins, so `WA_MOCK_LATENCY_MS=500 npm run
// dev:mock` still tunes the mock transport.
const env = { ...mockEnv, ...process.env }

console.log('dev:mock — license service: mock · WhatsApp transport: mock')
console.log('activate with any key starting VALID- (e.g. VALID-DEMO-001)\n')

// A single command string rather than argv: npm is a shell script on every
// platform, so this has to go through a shell anyway, and passing args
// separately with `shell: true` is deprecated in Node.
const child = spawn('npm run dev', {
  env,
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
