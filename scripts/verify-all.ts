/** One CI/local gate: compile, production bundle, physics, inputs and services. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const python = process.env['PYTHON'] ?? (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3')
const jobs: [string, string[]][] = [
  ['npm', ['run', 'build']],
  ...['verify-sims', 'verify-sandbox', 'verify-rope', 'verify-audit', 'verify-inputs', 'verify-api'].map(name => [process.execPath, ['--import', 'tsx', `scripts/${name}.ts`]] as [string, string[]]),
  ...['panel/test_panel.py', 'panel/test_rope_game.py', 'panel/test_recovery.py', 'gx10/test_launcher.py'].map(file => [python, [file]] as [string, string[]]),
  ['bash', ['-n', 'gx10/demo.sh', 'gx10/demo-stop.sh', 'gx10/setup.sh', 'gx10/install-demo.sh', 'panel/setup.sh', 'panel/launch_panel.sh']],
]
for (const [command, args] of jobs) {
  console.log(`\nChecking ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, PANEL_LIGHT: '0' }, timeout: 120_000 })
  if (result.error || result.status !== 0) { console.error(result.error ?? `Failed with status ${result.status}`); process.exit(1) }
}
console.log('\nAll verification gates passed. Hardware rehearsal remains separate.')
