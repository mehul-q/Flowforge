export function failpoint(name: string): void {
  const enabledList = process.env.FAILPOINTS ?? '';
  const isEnabled = enabledList.split(',').map(s => s.trim()).includes(name);
  
  if (!isEnabled) return;

  const p = Number(process.env.FAILPOINT_P ?? '0.1');
  
  if (Math.random() < p) {
    console.log(`FAILPOINT TRIGGERED: ${name}`);
    process.exit(1); 
  }
}