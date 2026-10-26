import React, {CSSProperties, ReactNode} from 'react';
import {Img, interpolate, staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';

export const androidFontReady = loadFont({family: 'Android', url: staticFile('fonts/Roboto-Variable.ttf'), weight: '100 900'});

const ui = {bar: '#202d3b', background: '#0f1b26', incoming: '#233343', outgoing: '#31597d', text: '#f3f6f8', blue: '#91caf3', dim: '#99acbd'};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], clamp);

export const PHONE = {width: 360, height: 800, left: 180, top: 310} as const;

export const UiIcon: React.FC<{name: string; size?: number; color?: string}> = ({name, size = 23, color = ui.text}) => {
  const paths: Record<string, ReactNode> = {
    back: <path d="M20 12H4m7-7-7 7 7 7"/>,
    more: <><circle cx="12" cy="5" r="1.2" fill={color}/><circle cx="12" cy="12" r="1.2" fill={color}/><circle cx="12" cy="19" r="1.2" fill={color}/></>,
    call: <path d="M6 3 3 6c-1 7 8 16 15 15l3-3-5-4-3 2c-3-1-4-2-5-5l2-3z"/>,
    clip: <path d="m8 15 7-7c4-4 8 1 4 5l-9 9c-5 4-11-2-7-6L14 5c2-2 5 1 3 3L7 18c-1 1-2-1-1-2l8-8"/>,
    smile: <><circle cx="12" cy="12" r="9"/><path d="M7.5 14.5q4.5 6 9 0"/><path d="M8 8h.1M16 8h.1" strokeWidth="3"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6"/></>,
    play: <path d="M8 5v14l12-7Z" fill={color} stroke="none"/>,
    checks: <><path d="m2 12 4 4L16 6M10 14l2 2L22 6"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    copy: <><rect x="8" y="7" width="12" height="14" rx="2"/><path d="M15 3H4v14"/></>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v6M14 10v6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}}>{paths[name]}</svg>;
};

const Wallpaper: React.FC = () => <svg width="100%" height="100%" style={{position: 'absolute', inset: 0, opacity: 0.2}}>
  <defs><pattern id="android-wallpaper" width="150" height="158" patternUnits="userSpaceOnUse">
    <g fill="none" stroke="#476273" strokeWidth="1.3" transform="scale(.83)">
      <path d="M25 27c-8-13-23-1-14 10l14 12 15-12c10-12-8-24-15-10Z"/>
      <path d="m111 10 29 10-21 20-3-14-13-6 37 0"/>
      <path d="M60 88h39v27H78l-12 9 2-9h-8z"/><path d="M68 96h22M68 103h17"/>
      <path d="m144 113 4 9 10 1-8 7 2 10-8-5-9 5 2-10-7-7 10-1Z"/>
      <path d="M25 157q12-24 24 0t24 0M98 166a13 13 0 0 0 14-20 15 15 0 1 1-14 20"/>
      <circle cx="154" cy="73" r="5"/><circle cx="31" cy="102" r="3"/>
    </g>
  </pattern></defs><rect width="100%" height="100%" fill="url(#android-wallpaper)"/>
</svg>;

const StatusBar: React.FC = () => <div style={{height: 25, background: ui.bar, display: 'flex', alignItems: 'center', padding: '0 19px', fontSize: 12, fontWeight: 500, gap: 5}}>
  <span>17:42</span><span style={{marginLeft: 'auto', fontSize: 10}}>4G</span>
  <svg width="15" height="13" viewBox="0 0 20 18"><path d="M2 16h3v-4H2zm5 0h3V8H7zm5 0h3V4h-3zm5 0h2V1h-2z" fill={ui.text}/></svg>
  <svg width="21" height="14" viewBox="0 0 27 18"><rect x="1" y="4" width="21" height="11" rx="2" fill="none" stroke={ui.text} strokeWidth="1.3"/><path d="M24 7v5" stroke={ui.text} strokeWidth="2"/><rect x="3" y="6" width="15" height="7" rx="1" fill={ui.text}/></svg>
</div>;

const Avatar: React.FC<{name: string; bot?: boolean}> = ({name, bot}) => bot
  ? <Img src={staticFile('agent-avatar.jpg')} style={{width: 35, height: 35, flexShrink: 0, borderRadius: '50%'}}/>
  : <div style={{width: 35, height: 35, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: ['Аня', 'Любимая', 'Алина'].includes(name) ? 'linear-gradient(135deg,#d08ea9,#975ca4)' : 'linear-gradient(135deg,#5ba8cb,#4d72b4)', fontSize: 20, fontWeight: 500}}>{name[0]}</div>;

export const AndroidThread: React.FC<{name: string; bot?: boolean; recording?: boolean; selected?: boolean; children: ReactNode; style?: CSSProperties}> = ({name, bot = false, recording = false, selected = false, children, style}) => <div style={{position: 'absolute', inset: 0, background: ui.background, ...style}}>
  <div style={{height: 59, background: ui.bar, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, boxShadow: '0 2px 4px #0003', position: 'relative', zIndex: 1}}>
    {selected ? <><UiIcon name="close"/><span style={{fontSize: 23, marginLeft: 8}}>1</span><div style={{marginLeft: 'auto', display: 'flex', gap: 24}}><UiIcon name="copy"/><UiIcon name="arrow"/><UiIcon name="trash"/></div></> : <>
    <UiIcon name="back" size={23}/><Avatar name={name} bot={bot}/>
    <div style={{minWidth: 0}}><div style={{fontSize: bot ? 18 : 20, fontWeight: 500, whiteSpace: 'nowrap'}}>{name}</div><div style={{fontSize: 13, color: bot ? ui.dim : ui.blue, marginTop: 2}}>{bot ? 'бот' : 'в сети'}</div></div>
    <div style={{marginLeft: 'auto', display: 'flex', gap: 13, alignItems: 'center'}}>{!bot && <UiIcon name="call" size={20}/>}<UiIcon name="more" size={22}/></div>
    </>}
  </div>
  <div style={{position: 'absolute', left: 0, right: 0, top: 59, bottom: 67, overflow: 'hidden'}}>
    <Wallpaper/>
    <div style={{position: 'absolute', top: 11, left: 0, right: 0, textAlign: 'center'}}><span style={{fontSize: 12, background: '#294355c9', padding: '4px 10px', borderRadius: 18, color: '#d2e0e9'}}>Сегодня</span></div>
    {children}
  </div>
  <div style={{position: 'absolute', bottom: 17, left: 7, right: 7, height: 43, display: 'flex', gap: 6, alignItems: 'center'}}>
    <div style={{height: 43, background: ui.bar, borderRadius: 24, padding: '0 11px', display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0}}>
      {recording ? <><span style={{width: 8, height: 8, borderRadius: '50%', background: '#ff8d8d'}}/><span style={{fontSize: 16, color: '#d7e7f2'}}>0:04</span><span style={{marginLeft: 'auto', fontSize: 14, color: ui.dim}}>Запись…</span></> : <><UiIcon name="smile" size={23} color={ui.dim}/><span style={{fontSize: 17, color: ui.dim}}>Сообщение</span><span style={{marginLeft: 'auto', display: 'flex'}}><UiIcon name="clip" size={22} color={ui.dim}/></span></>}
    </div><div style={{width: 43, height: 43, flexShrink: 0, background: recording ? '#3375a6' : '#578fbd', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><UiIcon name="mic" size={24}/></div>
  </div>
  <div style={{position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', width: 98, height: 3, background: '#becad1', borderRadius: 4}}/>
</div>;

// 9:20 portrait viewport, based on the published Pixel display aspect ratio.
export const AndroidWindow: React.FC<{children: ReactNode; style?: CSSProperties}> = ({children, style}) => <div style={{position: 'absolute', top: PHONE.top, left: PHONE.left, width: PHONE.width, height: PHONE.height, borderRadius: 31, overflow: 'hidden', outline: '2px solid #53636e', boxShadow: '0 16px 35px #0007', fontFamily: 'Android, sans-serif', color: ui.text, ...style}}>
  <StatusBar/><div style={{position: 'absolute', top: 25, bottom: 0, left: 0, right: 0, overflow: 'hidden'}}>{children}</div>
</div>;

export const TelegramBubble: React.FC<{children: ReactNode; top: number; right?: boolean; width?: number; stamp?: string; style?: CSSProperties; fontSize?: number}> = ({children, top, right = false, width = 304, stamp = '17:42', style, fontSize = 24}) => <div style={{position: 'absolute', top, ...(right ? {right: 11} : {left: 11}), width, boxSizing: 'border-box', padding: '10px 12px 7px', borderRadius: right ? '15px 15px 4px 15px' : '15px 15px 15px 4px', background: right ? ui.outgoing : ui.incoming, fontSize, lineHeight: 1.24, ...style}}>
  <div style={{whiteSpace: 'pre-wrap', overflowWrap: 'break-word'}}>{children}</div>
  <div style={{display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 11, color: right ? '#b3cce0' : '#99aebf', marginTop: 4, height: 14}}>{stamp}{right && <UiIcon name="checks" size={16} color="#82c5f4"/>}</div>
  <svg width="7" height="10" viewBox="0 0 9 12" style={{position: 'absolute', bottom: 0, ...(right ? {right: -4, transform: 'scaleX(-1)'} : {left: -4})}}><path d="M9 0v12H0Q7 8 9 0" fill={right ? ui.outgoing : ui.incoming}/></svg>
</div>;

export const Notification: React.FC<{frame: number; from: number; until: number; text: string}> = ({frame, from, until, text}) => <div style={{position: 'absolute', top: 6, left: 6, right: 6, zIndex: 5, background: '#293b4bf5', boxShadow: '0 5px 20px #0007', borderRadius: 18, border: '1px solid #597080', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9, opacity: ramp(frame, from, from + 6) * (1 - ramp(frame, until - 5, until)), transform: `translateY(${(1 - ramp(frame, from, from + 9)) * -75}px)`}}>
  <Img src={staticFile('agent-avatar.jpg')} style={{width: 36, height: 36, borderRadius: '50%'}}/>
  <div><div style={{fontSize: 14, fontWeight: 500}}>Your Secret Agent <span style={{fontSize: 10, color: ui.dim}}>· сейчас</span></div><div style={{fontSize: 17, marginTop: 4}}>{text}</div></div>
</div>;

export const Waveform: React.FC<{frame: number; duration?: string; outgoing?: boolean}> = ({frame, duration = '0:04', outgoing = false}) => <div style={{display: 'flex', alignItems: 'center', gap: 11, height: 43}}>
  <div style={{width: 37, height: 37, borderRadius: '50%', background: outgoing ? '#abd7f7' : ui.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}><UiIcon name="play" color="#1b3040" size={24}/></div>
  <div><div style={{display: 'flex', gap: 3, alignItems: 'center', height: 24}}>{Array.from({length: 29}, (_, i) => <div key={i} style={{width: 3, height: 4 + Math.sin(i * 2.07) ** 2 * 19, borderRadius: 3, background: outgoing ? '#b9ddf6' : '#78b8e7', opacity: 0.85 + Math.sin(frame / 15 + i) * 0.12}}/>)}</div><div style={{color: ui.blue, fontSize: 11, marginTop: 2}}>{duration}</div></div>
</div>;

export const EntityText: React.FC<{text: string; entities: Array<{type: string; offset: number; length: number}>}> = ({text, entities}) => {
  // Telegram offsets and JS string slicing both use UTF-16 code units.
  const boundaries = [...new Set([0, text.length, ...entities.flatMap((e) => [e.offset, e.offset + e.length])])].sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1];
    const active = entities.filter((e) => start >= e.offset && end <= e.offset + e.length);
    return <span key={start} style={{fontWeight: active.some((e) => e.type === 'bold') ? 700 : 400, textDecoration: active.some((e) => e.type === 'strikethrough') ? 'line-through' : undefined}}>{text.slice(start, end)}</span>;
  })}</>;
};
