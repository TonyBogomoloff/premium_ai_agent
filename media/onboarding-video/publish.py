"""Install only the two reviewed promo assets; run on the authorized server."""
from pathlib import Path
import datetime, fcntl, hashlib, json, os, shutil
root=Path('/home/tony/Desktop/_code/premium_ai_agent')
stage=Path('/tmp/premium-emoji-video-v1')
names=['emoji-studio-v1-ru.mp4','emoji-studio-v1-cover.png']
with (root/'.data/deploy.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    targets=[root/folder/name for folder in ['public/promo','dist/promo'] for name in names]
    for path in targets:
        if path.exists(): raise RuntimeError('Concurrent source change: '+str(path))
    hashes=json.loads((stage/'sha256.json').read_text())
    for name in names:
        assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==hashes[name]
    backup=root/'.data'/('backup-promo-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir()
    (backup/'rollback.json').write_text(json.dumps({'previously_absent':[str(p.relative_to(root)) for p in targets],'sha256':hashes},indent=2))
    installed=[]
    try:
        for path in targets:
            path.parent.mkdir(parents=True,exist_ok=True)
            temp=path.with_suffix(path.suffix+'.tmp')
            shutil.copy2(stage/path.name,temp)
            os.replace(temp,path)
            installed.append(path)
    except Exception:
        for path in installed: path.unlink()
        raise
    print(json.dumps({'published':True,'rollback':str(backup),'sha256':hashes}))
