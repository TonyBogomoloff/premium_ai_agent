"""Verify the exported artifact, without touching the live bot."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
video = root / 'output/remotion/emoji-studio-v1-ru.mp4'
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video),
]))
stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
assert (stream['width'], stream['height']) == (720, 1280)
assert stream['codec_name'] == 'h264'
assert stream['pix_fmt'] == 'yuv420p'
assert stream['avg_frame_rate'] == '30/1'
assert int(stream['nb_frames']) == 900
assert abs(float(probe['format']['duration']) - 30) < 0.05
assert not any(s['codec_type'] == 'audio' for s in probe['streams'])
subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-f', 'null', '-'], check=True)
report = {
    'duration_seconds': 30, 'width': 720, 'height': 1280, 'fps': 30,
    'frames': 900, 'codec': 'h264', 'pixel_format': 'yuv420p',
    'audio': False, 'decode_ok': True, 'bytes': video.stat().st_size,
    'sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
}
(video.parent / 'validation-v1.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
