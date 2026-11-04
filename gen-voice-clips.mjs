// gen-voice-clips.mjs —— 用本机 Breeze-TTS（真人音色克隆）预渲染教练话术的音频片段库
//
// 为什么要预渲染：浏览器自带的 speechSynthesis 中文音色是"语音助手腔"，
// 用户听了直接说"别那么机器人感"。而页面是公开静态站，用云端 TTS 会把 API Key
// 暴露在网页里；用户又硬约束"只用平板、不用电脑"。
// → 唯一的正解：用本机 Breeze-TTS 把固定片段一次性合成成 mp3，
//   运行时在页面上按句拼装播放。成品依然纯离线、无 Key、无后端。
//
// 片段清单直接来自 src/coach.js 的模板表（F / U / 数字 / 音名），
// 保证"字幕说什么，语音就说什么"，不会跑偏。
//
// 用法：
//   node gen-voice-clips.mjs            # 全量生成（已存在的跳过，可断点续跑）
//   ONLY=3 node gen-voice-clips.mjs      # 只做前 3 条，试跑
//   VOICE=male_anchor node gen-voice-clips.mjs

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { F, U, NOTE_KEYS, numClips } from './src/coach.js';

const APP = 'D:/ZW/Documents/deepseek-harness/default-workspace/Breeze-TTS-2.cpp/app/breeze-tts-2-v0.1.3-windows-x64-vulkan';
const EXE = path.join(APP, 'breeze-cli.exe');
const MODEL = 'breeze-tts-2-q4_k.gguf';
const VOICE = process.env.VOICE || 'female_anchor';
const SEED = process.env.SEED || '7';
const RAWDIR = 'voice-raw';
const OUTDIR = 'public/voice/clips';
const MANIFEST = 'public/voice/manifest.json';
// 注意：breeze-cli 的 --output 必须是绝对路径。
// 它是跑在 app 目录下的独立进程，给相对路径会落到 app 目录里（或直接失败）。
const ABS_RAW = path.resolve(RAWDIR);
const FFMPEG = 'C:/Users/ZW/AppData/Local/huashu-motion/.bin/ffmpeg.exe';
const FFPROBE = FFMPEG.replace(/ffmpeg\.exe$/, 'ffprobe.exe');
const ONLY = Number(process.env.ONLY || 0);

// ---------- 1. 片段清单（和 coach.js 的模板表同源）----------
const clips = [];
const seen = new Set();
const add = (key, text) => {
  if (!text || seen.has(key)) return;
  seen.add(key);
  clips.push({ key, text });
};

for (const k of Object.keys(F)) add('f:' + k, F[k]);
for (const k of Object.keys(U)) add('u:' + k, U[k]);
for (let n = 0; n <= 200; n++) for (const tok of numClips(n)) add('n:' + tok, tok);
for (const k of NOTE_KEYS) add('k:' + k, k);

// 文件名 = key 的短哈希，而不是序号。
// 踩过的坑：一开始用序号 c001/c002…，后来从模板表里删掉一条，
// 后面的片段全部前移一位 —— 断点续跑会把旧音频错配到新 key 上（静默配错音）。
// 由 key 决定的哈希名天然免疫这个问题。
const clipId = (key) => createHash('sha1').update(key).digest('hex').slice(0, 10);
clips.forEach((c) => (c.id = clipId(c.key)));

const list = ONLY ? clips.slice(0, ONLY) : clips;
console.log(`片段总数 ${clips.length}${ONLY ? `（本次只做前 ${list.length} 条）` : ''}，音色 ${VOICE}`);

fs.mkdirSync(RAWDIR, { recursive: true });
fs.mkdirSync(OUTDIR, { recursive: true });

// ---------- 2. 逐条合成 → 去静音 → mp3 ----------
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { clips: {} };
manifest.version = 1;
manifest.voice = VOICE;
manifest.clips = manifest.clips || {};

let made = 0;
let skipped = 0;
let failed = 0;
const t0 = Date.now();

for (const c of list) {
  const mp3 = path.join(OUTDIR, c.id + '.mp3');
  if (fs.existsSync(mp3) && fs.statSync(mp3).size > 400) {
    skipped++;
    if (!manifest.clips[c.key]) {
      manifest.clips[c.key] = { id: c.id, file: 'clips/' + c.id + '.mp3', text: c.text, dur: probeDur(mp3) };
    }
    continue;
  }

  const wav = path.join(ABS_RAW, c.id + '.wav');
  const r = spawnSync(EXE, [MODEL, '--text', c.text, '--output', wav, '--voice', VOICE, '--seed', SEED], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (!fs.existsSync(wav) || fs.statSync(wav).size < 1000) {
    failed++;
    console.log(`  ✗ ${c.id} ${c.key} 「${c.text}」 合成失败 ${(r.stderr || r.stdout || '').trim().replace(/\s+/g, ' ').slice(-200)}`);
    continue;
  }

  // 去掉首尾静音（TTS 每条都会留一截，拼起来会一顿一顿的）
  const filt =
    'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB,' +
    'areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB,areverse';
  const f = spawnSync(
    FFMPEG,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-af', filt, '-ac', '1', '-ar', '24000', '-b:a', '48k', '-f', 'mp3', mp3],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (!fs.existsSync(mp3) || fs.statSync(mp3).size < 400) {
    failed++;
    console.log(`  ✗ ${c.id} ${c.key} ffmpeg 失败 ${(f.stderr || '').trim().slice(0, 160)}`);
    continue;
  }

  const dur = probeDur(mp3);
  manifest.clips[c.key] = { id: c.id, file: 'clips/' + c.id + '.mp3', text: c.text, dur };
  made++;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  [${made + skipped}/${list.length}] ${c.id} ${c.key} ${dur.toFixed(2)}s 「${c.text.slice(0, 24)}」 (${secs}s)`);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');

const totalDur = Object.values(manifest.clips).reduce((n, x) => n + (x.dur || 0), 0);
console.log(`\n完成：新做 ${made}，已存在 ${skipped}，失败 ${failed}；清单 ${Object.keys(manifest.clips).length} 条，共 ${totalDur.toFixed(1)}s`);

function probeDur(file) {
  const p = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
    timeout: 20000,
  });
  const v = parseFloat((p.stdout || '').trim());
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
