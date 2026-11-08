export function failpoint(name: string): void {
  const enabled = (process.env.FAILPOINTS ?? '').split(',').includes(name);
  if (!enabled) return;
  const p = Number(process.env.FAILPOINT_P ?? '0.1');
  if (Math.random() < p) {
    console.log(`FAILPOINT: ${name} at ${new Date().toISOString()}`);
    process.kill(process.pid, 'SIGKILL');
  }
}