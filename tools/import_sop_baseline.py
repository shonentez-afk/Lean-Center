#!/usr/bin/env python3
"""Import pinned public SOP source, verify every Git blob, then copy. No runtime data."""
import argparse, hashlib, json, subprocess, tempfile, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def git(*args, cwd=None):
    return subprocess.check_output(['git',*args],cwd=cwd)
def blob(data):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--verify-only',action='store_true')
    args=ap.parse_args()
    m=json.loads((ROOT/'baselines/sop-stage43/source-manifest.json').read_text())
    dest=ROOT/'baselines/sop-stage43'
    if not args.verify_only:
        with tempfile.TemporaryDirectory() as temp:
            checkout=Path(temp)/'source'
            git('init','-q',str(checkout))
            git('fetch','--depth=1','https://github.com/'+m['repository']+'.git',m['commit'],cwd=checkout)
            assert git('rev-parse','FETCH_HEAD',cwd=checkout).decode().strip()==m['commit']
            for f in m['files']:
                data=git('show',m['commit']+':'+f['path'],cwd=checkout)
                if blob(data)!=f['sha']: raise ValueError(f['path'])
                path=dest/f['path']
                if path.exists() and path.read_bytes()!=data: raise ValueError('Refusing overwrite: '+str(path))
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_bytes(data)
    for f in m['files']:
        data=(dest/f['path']).read_bytes()
        if blob(data)!=f['sha']: raise ValueError(f['path'])
    print('Verified',len(m['files']),'pinned source files')
if __name__=='__main__': main()
