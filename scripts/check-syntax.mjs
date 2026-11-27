import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const dirs=['api','apps/api/src','apps/worker/src','packages/core/src'];
let fail=0;
async function walk(dir){for(const d of await readdir(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isDirectory())await walk(p);else if(p.endsWith('.ts')){const r=spawnSync(process.execPath,['--experimental-strip-types','--check',p],{encoding:'utf8'});if(r.status!==0){console.error(p,r.stderr);fail++}}}}
for(const d of dirs)await walk(d);
console.log(fail?'Syntax errors: '+fail:'TypeScript syntax checks passed');process.exitCode=fail?1:0;
