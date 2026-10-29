// 转录引擎：麦克风录音 → 解码重采样 → Basic Pitch 本地推理 → 音符事件
// 录音不离开设备，推理全部在浏览器里完成。

import * as tf from '@tensorflow/tfjs';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import { cleanNotes } from './notes.js';

const MODEL_URL = `${import.meta.env.BASE_URL}model/model.json`;

let backend = null;
let basicPitch = null;
let loadPromise = null;

export function getBackend() {
  return backend;
}

async function initBackend() {
  if (backend) return backend;
  await tf.ready();
  for (const name of ['webgl', 'cpu']) {
    if (tf.findBackend(name)) {
      try {
        await tf.setBackend(name);
        backend = name;
        return backend;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error('没有可用的 TF.js 后端');
}

export async function ensureModel(onLog = () => {}) {
  if (basicPitch) return basicPitch;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const b = await initBackend();
    onLog(`TF.js 后端：${b}`);
    onLog(`加载模型：${MODEL_URL}`);
    const bp = new BasicPitch(MODEL_URL);
    await bp.model;
    basicPitch = bp;
    onLog('模型加载完成');
    return bp;
  })();

  return loadPromise;
}

function pickMimeType() {
  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/** 开始录音，返回一个可 stop 的句柄 */
export async function startCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const mimeType = pickMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  return {
    mimeType: recorder.mimeType,
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };
        recorder.stop();
      });
    },
  };
}

async function decodeToMono22050(arrayBuffer) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }

  const targetRate = 22050;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * targetRate),
    targetRate,
  );
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** blob → 音符事件数组（已做泛音/重复清理） */
export async function transcribeBlob(blob, { onProgress = () => {}, onLog = () => {} } = {}) {
  const bp = await ensureModel(onLog);

  const arrayBuffer = await blob.arrayBuffer();
  const mono = await decodeToMono22050(arrayBuffer);
  onLog(
    `解码完成，样本数：${mono.length}（${(mono.length / 22050).toFixed(2)}s）`,
  );

  const frames = [];
  const onsets = [];
  const contours = [];

  await bp.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress(p),
  );

  const rawNotes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.25, 0.25, 5),
    ),
  );

  const notes = cleanNotes(rawNotes);
  onLog(`推理完成：${rawNotes.length} → ${notes.length} 个音符（已去泛音）`);

  return notes;
}
