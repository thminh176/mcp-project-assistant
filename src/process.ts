import { spawn } from 'node:child_process';
export async function run(executable: string, args: string[], cwd: string, timeoutMs = 30000) {
  return new Promise<{ exitCode: number | null; output: string; timedOut: boolean; truncated: boolean }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key];
    env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_TERMINAL_PROMPT = '0'; env.GIT_OPTIONAL_LOCKS = '0'; env.NO_COLOR = '1';
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let timedOut = false; let truncated = false;
    const stop = () => {
      if (process.platform === 'win32' && child.pid) {
        spawn(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const collect = (bytes: Buffer) => {
      const text = bytes.toString('utf8');
      output += text.slice(0, Math.max(0, 64000 - output.length));
      if (output.length >= 64000) { truncated = true; stop(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', exitCode => { clearTimeout(timer); resolve({ exitCode, output, timedOut, truncated }); });
  });
}
